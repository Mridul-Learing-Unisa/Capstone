export default function BatteryIcon({ level }: { level?: number | null }) {
    const isLow = level != null && level <= 20
    const isMedium = level != null && level > 20 && level <= 50
    const color = isLow
        ? "var(--error-color)"
        : isMedium
        ? "var(--processing-color)"
        : "var(--success-color)"

    // Width of the fill block (0 to 9 px inside the 14px outer body)
    const fillWidth = level != null ? Math.max(1, Math.min(9, Math.round((level / 100) * 9))) : 0

    return (
        <svg
            className="w-[1.1rem] h-[0.75rem] inline-block align-middle shrink-0"
            viewBox="0 0 16 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            {/* Battery outer shell */}
            <rect
                x="0.75"
                y="0.75"
                width="12.5"
                height="8.5"
                rx="1.75"
                stroke="currentColor"
                strokeWidth="1.1"
                className="opacity-70"
            />
            {/* Battery positive terminal */}
            <path
                d="M14.75 3.5V6.5"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinecap="round"
                className="opacity-70"
            />
            {/* Filled level */}
            {level != null && (
                <rect
                    x="2.25"
                    y="2.25"
                    width={fillWidth}
                    height="5.5"
                    rx="0.75"
                    fill={color}
                />
            )}
        </svg>
    )
}

