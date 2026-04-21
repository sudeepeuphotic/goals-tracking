export default function StatusLight({ value, size = 12 }) {
  const cls = value === "green" ? "status-dot-green" :
              value === "yellow" ? "status-dot-yellow" :
              value === "red" ? "status-dot-red" : "bg-neutral-300";
  return <span className={`inline-block ${cls}`} style={{ width: size, height: size }} />;
}
