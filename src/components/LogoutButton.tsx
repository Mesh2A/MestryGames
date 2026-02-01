"use client";

import { signOut } from "next-auth/react";
import type { CSSProperties } from "react";

type Props = {
  className?: string;
  style?: CSSProperties;
};

export default function LogoutButton({ className, style }: Props) {
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={() => signOut({ callbackUrl: "/" })}
    >
      تسجيل خروج
    </button>
  );
}
