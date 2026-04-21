import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";

function statusValue(s) {
  return s === "green" ? 3 : s === "yellow" ? 2 : s === "red" ? 1 : 0;
}
function statusColor(s) {
  return s === "green" ? "#00C853" : s === "yellow" ? "#FFD600" : s === "red" ? "#FF3D00" : "#999";
}

function parseNumber(v) {
  if (v == null) return null;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export default function ProgressChart({ objective, updates }) {
  // Sort oldest→newest by created_at
  const sorted = [...updates].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const data = sorted.map((u) => ({
    week: u.week,
    value: statusValue(u.status),
    status: u.status,
    progress: parseNumber(u.progress) || 0,
  }));

  const current = parseNumber(objective?.current_value);
  const target = parseNumber(objective?.target_value);
  const metricData = current != null && target != null
    ? [{ name: "Current", value: current }, { name: "Target", value: target }]
    : null;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="brutal-card p-4">
        <div className="mono-label mb-2">STATUS OVER TIME</div>
        {data.length === 0 ? (
          <div className="text-sm text-[var(--ink-soft)] py-10 text-center">No updates yet.</div>
        ) : (
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#E5E5E0" strokeDasharray="0" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={{ stroke: "#0A0A0A" }} />
                <YAxis domain={[0, 3]} ticks={[1, 2, 3]}
                  tickFormatter={(v) => (v === 3 ? "G" : v === 2 ? "Y" : v === 1 ? "R" : "")}
                  tick={{ fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={{ stroke: "#0A0A0A" }} />
                <Tooltip
                  contentStyle={{ borderRadius: 0, border: "1px solid #0A0A0A", background: "#fff" }}
                  formatter={(_, __, item) => [item?.payload?.status?.toUpperCase(), "Status"]}
                />
                <Line type="stepAfter" dataKey="value" stroke="#0A0A0A" strokeWidth={2} dot={{ r: 5, fill: "#0A0A0A" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="brutal-card p-4">
        <div className="mono-label mb-2">METRIC · {objective?.success_metric || "—"}</div>
        {!metricData ? (
          <div className="text-sm text-[var(--ink-soft)] py-10 text-center">
            Numeric current/target not set on this objective.
          </div>
        ) : (
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={metricData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#E5E5E0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={{ stroke: "#0A0A0A" }} />
                <YAxis tick={{ fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={{ stroke: "#0A0A0A" }} />
                <Tooltip contentStyle={{ borderRadius: 0, border: "1px solid #0A0A0A", background: "#fff" }} />
                <Bar dataKey="value">
                  {metricData.map((d, i) => <Cell key={i} fill={i === 0 ? "#0A0A0A" : "#0055FF"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-1 text-xs font-mono text-[var(--ink-soft)] flex gap-4">
          <span>CURRENT · {objective?.current_value || "—"}</span>
          <span>TARGET · {objective?.target_value || "—"}</span>
        </div>
      </div>
    </div>
  );
}
