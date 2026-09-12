import { Link } from "react-router-dom";

/** Placeholder — replaced by T003 (campaign list) onward. */
export function CampaignManager() {
  return (
    <main style={{ padding: 24 }}>
      <h1>TableMap</h1>
      <p>Campaign manager placeholder.</p>
      <Link to="/dm" style={{ color: "#8cf" }}>
        Open DM view
      </Link>
    </main>
  );
}
