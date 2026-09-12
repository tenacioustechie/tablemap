#!/usr/bin/env node
// TableMap build loop — zero-dependency, Node >= 18, ESM.
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CFG = JSON.parse(readFileSync(join(ROOT, "harness", "config.json"), "utf8"));
const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry-run");
const ONCE = ARGS.includes("--once");
const FORCED = ARGS.includes("--task") ? ARGS[ARGS.indexOf("--task") + 1] : null;
const START = Date.now();

const log = (...a) => console.log(`[loop ${new Date().toISOString()}]`, ...a);

// ---------- backlog ----------
function parseTask(file) {
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith("[")) v = v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    else if (v === "true") v = true;
    else if (v === "false") v = false;
    fm[kv[1]] = v;
  }
  return { file, raw, body: raw.slice(m[0].length).trim(), ...fm };
}

function loadBacklog() {
  const dir = join(ROOT, CFG.backlogDir);
  return readdirSync(dir)
    .filter((f) => /^T\d+\.md$/.test(f))
    .map((f) => parseTask(join(dir, f)))
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function setStatus(task, status) {
  const updated = task.raw.replace(/^status:.*$/m, `status: ${status}`);
  writeFileSync(task.file, updated);
  task.raw = updated;
  task.status = status;
  log(`${task.id} -> ${status}`);
}

function nextTask(tasks) {
  if (FORCED) return tasks.find((t) => t.id === FORCED) ?? null;
  const done = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
  return (
    tasks.find(
      (t) => t.status === "todo" && (t.depends ?? []).every((d) => done.has(d))
    ) ?? null
  );
}

// ---------- shell ----------
function sh(cmd, opts = {}) {
  try {
    const out = execSync(cmd, {
      cwd: opts.cwd ?? ROOT,
      stdio: "pipe",
      encoding: "utf8",
      timeout: (opts.timeoutMin ?? 30) * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, out };
  } catch (e) {
    const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim() || String(e);
    return { ok: false, out };
  }
}

function runGates(task) {
  const gates = [...CFG.gates, ...(task.e2e ? [CFG.e2eGate] : [])];
  for (const g of gates) {
    log(`gate: ${g.name}`);
    const r = sh(g.cmd, { cwd: join(ROOT, CFG.appDir), timeoutMin: 30 });
    if (!r.ok) return { ok: false, gate: g.name, out: r.out.slice(-8000) };
  }
  return { ok: true };
}

function checkCriteria(task) {
  const raw = readFileSync(task.file, "utf8");
  const unticked = raw.split("\n").filter((l) => /^\s*- \[ \]/.test(l));
  if (unticked.length === 0) return { ok: true };
  return {
    ok: false,
    gate: "criteria",
    out: `Unticked acceptance criteria in backlog/${task.id}.md — verify each against the implementation and change "- [ ]" to "- [x]", or fix the code until it is true:\n${unticked.join("\n")}`,
  };
}

// ---------- agent ----------
function agentPrompt(task, repairCtx) {
  const gateCmds =
    CFG.gates.map((g) => g.cmd).join(" && ") +
    (task.e2e ? ` && ${CFG.e2eGate.cmd}` : "");
  const base = [
    "You are working in the TableMap repo. Read CLAUDE.md (conventions) and docs/spec.md + docs/architecture.md as needed.",
    "",
    `Your single task is ${task.id}: ${task.title}. Full task file (backlog/${task.id}.md):`,
    "",
    task.body,
    "",
    `Implement it completely, including the required tests, inside ${CFG.appDir}/. Update docs per CLAUDE.md rule 4. Tick the acceptance-criteria checkboxes in backlog/${task.id}.md as you satisfy them, and record any assumptions under a "## Notes" heading in that file (those edits are allowed; do not change the status line).`,
    `Before finishing: re-read the acceptance criteria in backlog/${task.id}.md, verify each against your implementation, and change "- [ ]" to "- [x]" only for criteria that are actually met. An unticked box is treated as undone work by the harness.`,
    `Run the gates yourself before finishing: cd ${CFG.appDir} && ${gateCmds}`,
  ].join("\n");
  if (!repairCtx) return base;
  return [
    base,
    "",
    `PREVIOUS ATTEMPT FAILED the "${repairCtx.gate}" gate. Fix it. Gate output (tail):`,
    "",
    repairCtx.out,
  ].join("\n");
}

function runAgent(task, repairCtx) {
  const args = [...CFG.claudeArgs, agentPrompt(task, repairCtx)];
  log(`claude -p ${task.id}${repairCtx ? " (repair)" : ""}`);
  if (DRY) {
    log("dry-run: agent skipped");
    return { ok: true, dry: true };
  }
  const r = spawnSync(CFG.claudeCmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90 * 60_000,
    maxBuffer: 256 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  if (r.status !== 0) return { ok: false, out: out.slice(-8000) };
  let cost = null;
  let turns = null;
  try {
    const j = JSON.parse(r.stdout);
    cost = j.total_cost_usd ?? null;
    turns = j.num_turns ?? null;
  } catch {
    /* non-JSON output is fine */
  }
  return { ok: true, out, cost, turns };
}

// ---------- ledgers & git ----------
function metric(rec) {
  appendFileSync(
    join(ROOT, "harness", "metrics.jsonl"),
    JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n"
  );
}
function progress(line) {
  appendFileSync(join(ROOT, "PROGRESS.md"), `- ${new Date().toISOString()} ${line}\n`);
}
function needsHuman(task, reason, detail) {
  appendFileSync(
    join(ROOT, "NEEDS-HUMAN.md"),
    `\n## ${task.id}: ${task.title}\n${new Date().toISOString()} — ${reason}\n\n\`\`\`\n${(detail ?? "").slice(-4000)}\n\`\`\`\n`
  );
}
function gitCommit(msg) {
  if (!CFG.commitOnGreen) return;
  sh(`git add -A && git commit -m "${msg}"`);
}
function gitHardReset() {
  sh("git reset --hard && git clean -fd -e node_modules -e STOP");
}
// On a blocked task, park the agent's partial work on a side branch so a human
// (or a forced re-run) can pick it up, then return the main branch to the last
// green commit. Returns the branch name, or null if nothing was parked.
function parkBlockedWork(task) {
  const mode = CFG.onBlocked ?? "branch";
  if (mode === "keep") return null;
  if (mode !== "branch") {
    gitHardReset();
    return null;
  }
  // "Dirty" ignores the task file's status flip (todo -> doing), which happens on every run.
  const rel = task.file.slice(ROOT.length + 1);
  const dirty = sh("git status --porcelain");
  const others = (dirty.out ?? "").split("\n").filter((l) => l.trim() && !l.endsWith(rel));
  const taskDiff = sh(`git diff --numstat -- "${rel}"`).out.trim().split("\t");
  const taskOnlyStatus = taskDiff.length < 3 || (taskDiff[0] === "1" && taskDiff[1] === "1");
  if (!dirty.ok || (others.length === 0 && taskOnlyStatus)) return null; // nothing to park
  const cur = sh("git rev-parse --abbrev-ref HEAD");
  const orig = cur.ok ? cur.out.trim() : "HEAD";
  if (orig === "HEAD") {
    log("detached HEAD — cannot park work on a branch, hard-resetting instead");
    gitHardReset();
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `${CFG.blockedBranchPrefix ?? "loop/blocked/"}${task.id}-${stamp}`;
  let branch = base;
  for (let n = 2; sh(`git rev-parse --verify --quiet refs/heads/${branch}`).ok; n++) branch = `${base}-${n}`;
  const steps = [
    `git checkout -b ${branch}`,
    "git add -A",
    `git commit -m "${task.id}: partial work (blocked) [loop]"`,
    `git checkout ${orig}`,
  ];
  for (const cmd of steps) {
    const r = sh(cmd);
    if (!r.ok) {
      log(`park failed at "${cmd}": ${r.out.slice(-500)}`);
      sh(`git checkout -f ${orig}`);
      gitHardReset();
      return null;
    }
  }
  gitHardReset(); // belt and braces: drop anything checkout left behind
  log(`parked partial work on ${branch}`);
  return branch;
}

// ---------- main ----------
function shouldStop(tasksProcessed) {
  if (existsSync(join(ROOT, "STOP"))) {
    log("STOP file present");
    return true;
  }
  if (tasksProcessed >= CFG.maxTasksPerRun) {
    log("maxTasksPerRun reached");
    return true;
  }
  if ((Date.now() - START) / 60_000 >= CFG.maxMinutesPerRun) {
    log("maxMinutesPerRun reached");
    return true;
  }
  return false;
}

let processed = 0;
while (!shouldStop(processed)) {
  const tasks = loadBacklog();
  const task = nextTask(tasks);
  if (!task) {
    log("no runnable tasks — backlog empty, blocked, or waiting on deps");
    break;
  }
  log(`selected ${task.id}: ${task.title}`);
  if (DRY) {
    log(`(dry) would run ${task.id}, gates: base${task.e2e ? " + e2e" : ""}`);
    processed++;
    if (ONCE) break;
    break; // dry-run can only predict the first task; deps do not advance
  }

  setStatus(task, "doing");
  const t0 = Date.now();
  let attempt = 0;
  let gateResult = null;
  let agentResult = null;
  let repairCtx = null;

  while (attempt <= CFG.maxRepairAttemptsPerTask) {
    agentResult = runAgent(task, repairCtx);
    if (!agentResult.ok) {
      gateResult = { ok: false, gate: "agent", out: agentResult.out };
      break;
    }
    gateResult = runGates(task);
    if (gateResult.ok) gateResult = checkCriteria(task);
    if (gateResult.ok) break;
    log(`gate ${gateResult.gate} RED (attempt ${attempt + 1})`);
    repairCtx = gateResult;
    attempt++;
  }

  const minutes = ((Date.now() - t0) / 60_000).toFixed(1);
  if (gateResult.ok) {
    setStatus(task, "done");
    progress(`${task.id} done (${minutes} min, ${attempt} repairs, cost ${agentResult?.cost ?? "n/a"})`);
    metric({ task: task.id, result: "done", minutes: +minutes, repairs: attempt, cost: agentResult?.cost ?? null, turns: agentResult?.turns ?? null });
    gitCommit(`${task.id}: ${task.title} [loop]`);
  } else {
    const branch = parkBlockedWork(task); // park partial work on a side branch, then write ledgers on the clean tree
    const where = branch ? ` — partial work on branch ${branch}` : "";
    needsHuman(task, `gate "${gateResult.gate}" red after ${attempt} repair attempt(s)${where}`, gateResult.out);
    const fresh = loadBacklog().find((t) => t.id === task.id);
    if (fresh) setStatus(fresh, "blocked");
    progress(`${task.id} BLOCKED at ${gateResult.gate} (${minutes} min)${where}`);
    metric({ task: task.id, result: "blocked", gate: gateResult.gate, minutes: +minutes, repairs: attempt, branch });
    sh(`git add -A && git commit -m "${task.id}: blocked [loop]"`);
  }

  processed++;
  if (ONCE) break;
}
log(`run complete — ${processed} task(s) processed`);
