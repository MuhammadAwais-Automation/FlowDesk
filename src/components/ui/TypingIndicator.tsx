export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-0.5" aria-label="Typing">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-t3 animate-typing-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}
