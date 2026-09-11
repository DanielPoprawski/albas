import { type SVGProps, useId } from 'react';

export type LogoVariant = 'default' | 'bw' | 'full';

export interface LogoProps extends SVGProps<SVGSVGElement> {
  variant?: LogoVariant;
  size?: number | string;
}

export function Logo({ variant = 'default', size, width, height, fill, ...props }: LogoProps) {
  const id = useId().replace(/:/g, '');
  const gradId = `albas-grad-${id}`;

  if (variant === 'bw') {
    const glyphFill = fill ?? 'currentColor';
    return (
      <svg viewBox="0 0 512 512" width={width ?? size ?? 512} height={height ?? size ?? 512} {...props}>
        <path
          d="M 352.64213,163.92994 413.28,52.08 l 58.95456,422.68234 -78.20532,-0.0413 z"
          fill={glyphFill}
          fillOpacity={0.55}
        />
        <path
          d="M 313.80273 46.6875 C 313.78856 46.714256 313.77394 46.740823 313.75977 46.767578 L 286.22266 46.767578 L 255.42969 105.83398 L 281.96094 105.83398 C 249.48628 165.31906 216.10526 224.31592 183.19531 283.55859 L 154.49609 283.55859 L 123.70312 342.625 L 150.38477 342.625 L 114.07422 409.05273 L 86.029297 409.05273 L 55.236328 468.11914 L 81.789062 468.11914 L 81.765625 468.16211 L 168.49414 468.36133 L 238.37305 342.625 L 475.24219 342.625 L 462.71484 283.55859 L 271.19922 283.55859 L 402.84375 46.6875 L 313.80273 46.6875 z"
          fill={glyphFill}
        />
      </svg>
    );
  }

  if (variant === 'full') {
    const textFill = fill ?? 'currentColor';
    return (
      <svg
        viewBox="0 0 200 40"
        width={width ?? (typeof size === 'number' ? size * 5 : undefined) ?? 200}
        height={height ?? size ?? 40}
        role="img"
        aria-label="Albas"
        {...props}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#7e22ce" />
          </linearGradient>
        </defs>
        <text x="44" y="27" fontFamily="Sora, system-ui, sans-serif" fontSize={23} fontWeight={700} fill={textFill}>
          Albas
        </text>
        <rect width="32" height="32" x="0" y="4" fill={`url(#${gradId})`} />
        <path
          d="m 22.040133,14.245621 3.789866,-6.9906215 3.68466,26.4176465 -4.887833,-0.0026 z"
          fill="#ffffff"
          fillOpacity={0.55}
        />
        <path
          d="m 19.61267,6.9179685 c -9.15e-4,0.0016 -0.0019,0.0033 -0.0027,0.005 H 17.8889 l -1.924561,3.6916825 h 1.658203 c -2.029667,3.717817 -4.115979,7.405121 -6.172852,11.107787 H 9.6560352 l -1.924566,3.691652 h 1.667603 l -2.269409,4.151733 h -1.752854 l -1.92456,3.691651 h 1.659546 l -0.0015,0.0027 5.4205328,0.01245 4.367431,-7.858523 H 29.702647 L 28.919688,21.722433 H 16.949953 L 25.177735,6.9179895 Z"
          fill="#ffffff"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 512 512" width={width ?? size ?? 512} height={height ?? size ?? 512} {...props}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#7e22ce" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" x="0" y="0" fill={`url(#${gradId})`} />
      <path
        d="M 352.64213,163.92994 413.28,52.08 l 58.95456,422.68234 -78.20532,-0.0413 z"
        fill="#ffffff"
        fillOpacity={0.55}
      />
      <path
        d="M 313.80273 46.6875 C 313.78856 46.714256 313.77394 46.740823 313.75977 46.767578 L 286.22266 46.767578 L 255.42969 105.83398 L 281.96094 105.83398 C 249.48628 165.31906 216.10526 224.31592 183.19531 283.55859 L 154.49609 283.55859 L 123.70312 342.625 L 150.38477 342.625 L 114.07422 409.05273 L 86.029297 409.05273 L 55.236328 468.11914 L 81.789062 468.11914 L 81.765625 468.16211 L 168.49414 468.36133 L 238.37305 342.625 L 475.24219 342.625 L 462.71484 283.55859 L 271.19922 283.55859 L 402.84375 46.6875 L 313.80273 46.6875 z"
        fill="#ffffff"
      />
    </svg>
  );
}
