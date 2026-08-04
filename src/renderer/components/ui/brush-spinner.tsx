import { useEffect, useRef, useId } from "react"
import { motion, useAnimationControls } from "motion/react"

import { useReducedMotion } from "@/lib/reducedMotion"
import { cn } from "@/lib/utils"

interface BrushSpinnerProps {
  size?: number
  strokeWidth?: number
  color?: string
  glowColor?: string
  speed?: number
  className?: string
}

/**
 * How the ring is dashed, and whether anything drives it.
 *
 * A spinner is not decoration — it is the only thing on screen saying "still
 * working". So Reduce motion cannot simply stop the rotation: a 70% arc frozen at
 * whatever angle the last frame left it is worse than no spinner at all, because a
 * stalled spinner is the universal look of a hung app.
 *
 * The reduced answer is therefore a *closed* ring (gap 0). With no terminus there is
 * no angle to read, so it cannot look stuck part-way round — it reads as a static
 * status badge, which is what it now is. The "in progress" meaning is carried by
 * role="status"/aria-label and by the fact that the caller only mounts it while a
 * turn is running.
 */
export function resolveSpinnerArc(
  reduced: boolean,
  circumference: number,
): { dash: number; gap: number; animated: boolean } {
  if (reduced) {
    return { dash: circumference, gap: 0, animated: false }
  }

  const dash = circumference * 0.7
  return { dash, gap: circumference - dash, animated: true }
}

function BrushSpinner({
  size = 24,
  strokeWidth = 2.5,
  color = "currentColor",
  glowColor = "color-mix(in oklab, currentColor 25%, transparent)",
  speed = 1.2,
  className,
}: BrushSpinnerProps) {
  // The hook, not the imperative read: a spinner is long-lived and on screen
  // precisely while the user might reach for Settings, so turning Reduce motion on
  // has to stop this one now rather than on the next mount.
  const reduced = useReducedMotion()
  const controls = useAnimationControls()
  const rafRef = useRef<number>(0)
  const uniqueId = useId()

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const { dash, gap, animated } = resolveSpinnerArc(reduced, circumference)

  useEffect(() => {
    // Never start the rAF loop under reduced motion — and, because `animated`
    // is a dependency, tear it down mid-flight the moment the setting flips.
    if (!animated) return

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
  }, [speed, controls, animated])

  const filterId = `brush-glow-${uniqueId}`
  const gradientId = `brush-taper-${uniqueId}`

  if (!animated) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={className}
        role="status"
        aria-label="Loading"
      >
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
        {/*
          Flat currentColor rather than the tapered gradient: the gradient runs
          left-to-right across the box, so on a closed ring it would fade the two
          sides and reintroduce exactly the "which end is it at?" reading the closed
          ring exists to remove. No glow filter either — nothing is moving to justify
          the blur pass.
        */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeOpacity={0.55}
          strokeDasharray={`${dash} ${gap}`}
        />
      </svg>
    )
  }

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
        strokeDasharray={`${dash} ${gap}`}
        filter={`url(#${filterId})`}
        style={{ transformOrigin: "center", color }}
      />
    </motion.svg>
  )
}

export { BrushSpinner }
