export default function TopBar({ title, children }) {
  return (
    <div className="h-12 bg-surface-1 border-b border-border flex items-center justify-between px-4">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
