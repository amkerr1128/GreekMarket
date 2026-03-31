function IconBase({ children, className = "", viewBox = "0 0 24 24" }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

export function HomeIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path
        d="M4 10.75L12 4l8 6.75V20a1 1 0 0 1-1 1h-5.25v-6h-3.5v6H5a1 1 0 0 1-1-1v-9.25Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function PlusIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path
        d="M12 5.5v13M5.5 12h13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function SearchIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <circle cx="11" cy="11" r="5.75" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M16 16l3.75 3.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function UserIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path
        d="M12 12.25a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M4.5 20.25a7.5 7.5 0 0 1 15 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function MenuIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path
        d="M5 7h14M5 12h14M5 17h14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function ArrowLeftIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path
        d="M10 5.75 3.75 12 10 18.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M4.5 12h15.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function ChevronDownIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path
        d="m7 10 5 5 5-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function CheckIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path
        d="m6.75 12.5 3.25 3.25L17.5 8.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function MoonIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path
        d="M18.5 14.3A6.8 6.8 0 0 1 9.7 5.5a7.25 7.25 0 1 0 8.8 8.8Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function SunIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3.75v2.1M12 18.15v2.1M20.25 12h-2.1M5.85 12h-2.1M17.83 6.17l-1.49 1.49M7.66 16.34l-1.49 1.49M17.83 17.83l-1.49-1.49M7.66 7.66 6.17 6.17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function AvatarIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path
        d="M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        fill="currentColor"
      />
      <path
        d="M5 19.5c0-2.83 2.55-4.75 7-4.75s7 1.92 7 4.75"
        fill="currentColor"
      />
    </IconBase>
  );
}

export function BookmarkIcon({ className = "", filled = false }) {
  return (
    <IconBase className={className}>
      <path
        d="M7.25 4.75h9.5a1 1 0 0 1 1 1V20l-5.75-3-5.75 3V5.75a1 1 0 0 1 1-1Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={filled ? "1.5" : "1.8"}
      />
    </IconBase>
  );
}

export function BellIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path
        d="M12 20.1a1.7 1.7 0 0 0 1.68-1.45h-3.36A1.7 1.7 0 0 0 12 20.1Z"
        fill="currentColor"
      />
      <path
        d="M7.4 16.05h9.2c-.84-.74-1.4-1.72-1.4-3.04v-2.4a3.2 3.2 0 1 0-6.4 0v2.4c0 1.32-.56 2.3-1.4 3.04Z"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M8.5 8.55a3.5 3.5 0 0 1 7 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function CloseIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <path
        d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </IconBase>
  );
}

export function BlockIcon({ className = "" }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8.25 15.75 15.75 8.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}
