"use client";

import { signOut } from "next-auth/react";

type Props = {
  className?: string;
};

export default function LogoutButton({ className }: Props) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => signOut({ callbackUrl: "/" })}
    >
      تسجيل خروج
    </button>
  );
}

