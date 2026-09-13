/**
 * 加载指示器 — 旋转动画 + 可选标签
 */
interface SpinnerProps {
  label?: string
  className?: string
}

export default function Spinner({ label, className = 'h-10 w-10' }: SpinnerProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className={`relative ${className}`}>
        <div className="absolute inset-0 rounded-full border-2 border-white/20" />
        <div
          className="absolute inset-0 rounded-full border-2 border-transparent border-t-white"
          style={{ animation: 'spin 0.8s linear infinite' }}
        />
      </div>
      {label && <p className="text-sm text-white/60">{label}</p>}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
