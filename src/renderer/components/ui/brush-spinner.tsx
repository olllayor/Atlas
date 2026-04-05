import { useEffect, useRef, useId } from "react"
import { motion, useAnimationControls } from "motion/react"

import { cn } from "@/lib/utils"

interface BrushSpinnerProps {
  size?: number
  strokeWidth?: number
  color?: string
  glowColor?: string
  speed?: number
  className?: string
}

function BrushSpinner({
  size = 24,
  strokeWidth = 2.5,
  color = "rgba(255,255,255,0.9)",
  glowColor = "rgba(255,255,255,0.25)",
  speed = 1.2,
  className,
}: BrushSpinnerProps) {
  const controls = useAnimationControls()
  const rafRef = useRef<number>(0)
  const uniqueId = useId()

  useEffect(() => {
    const startTime = performance.now()
    const duration = 1000 / speed

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = (elapsed % duration) / duration
      controls.set({ rotate: progress * 360 })
      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [speed, controls])

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const arcLength = circumference * 0.7

  const filterId = `brush-glow-${uniqueId}`
  const gradientId = `brush-taper-${uniqueId}`

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      animate={controls}
      className={cn("will-change-transform", className)}
      role="status"
      aria-label="Loading"
    >
      <defs>
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={strokeWidth * 1.2} result="blur" />
          <feFlood floodColor={glowColor} result="glowColor" />
          <feComposite in="glowColor" in2="blur" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="15%" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="50%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="85%" stopColor="currentColor" stopOpacity="0.8" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect
        x={strokeWidth / 2}
        y={strokeWidth / 2}
        width={size - strokeWidth}
        height={size - strokeWidth}
        rx={size * 0.18}
        fill="none"
        stroke="var(--border-subtle)"
        strokeWidth={strokeWidth * 0.4}
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${arcLength} ${circumference - arcLength}`}
        filter={`url(#${filterId})`}
        style={{ transformOrigin: "center", color }}
      />
    </motion.svg>
  )
}

export { BrushSpinner }
