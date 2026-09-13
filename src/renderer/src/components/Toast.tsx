import { useEffect, useRef, useState } from 'react'

interface ToastMessage {
  id: number
  msg: string
}

export default function Toast(): React.JSX.Element {
  const [messages, setMessages] = useState<ToastMessage[]>([])
  const counterRef = useRef(0)

  useEffect(() => {
    return window.api.onNotify((msg) => {
      const id = counterRef.current++
      setMessages((prev) => [...prev, { id, msg }])

      // Auto-dismiss after 6 seconds
      setTimeout(() => {
        setMessages((prev) => prev.filter((t) => t.id !== id))
      }, 6000)
    })
  }, [])

  const dismiss = (id: number): void => {
    setMessages((prev) => prev.filter((t) => t.id !== id))
  }

  if (messages.length === 0) return <></>

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-4">
      {messages.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/90 backdrop-blur-sm transition-opacity duration-200 ease-out"
          role="alert"
        >
          <span className="flex-1">{toast.msg}</span>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="关闭"
            className="shrink-0 rounded-full p-1 text-white/60 transition-colors duration-200 ease-out hover:bg-white/10 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
