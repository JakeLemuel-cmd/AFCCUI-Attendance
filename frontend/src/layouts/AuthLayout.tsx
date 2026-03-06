import { Outlet } from "react-router-dom";
import coopVoteLogo from "@/assets/coop-vote-logo-cropped.png";

export function AuthLayout() {
  return (
    <div className="relative min-h-screen overflow-hidden app-shell-bg">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-8">
        <div className="grid w-full overflow-hidden rounded-2xl border bg-card shadow-card lg:grid-cols-2">
          <div className="hidden bg-gradient-to-br from-primary via-[#2148aa] to-[#163783] p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
            <div className="inline-flex items-center gap-2 text-xl font-bold">
              <img
                src={coopVoteLogo}
                alt=""
                aria-hidden="true"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
                className="h-10 w-auto rounded bg-white/90 p-1"
              />
              <span className="whitespace-nowrap">Coop Attendance</span>
            </div>
            <div className="space-y-3">
              <h1 className="text-3xl font-extrabold leading-tight">Secure Cooperative Attendance</h1>
              <p className="max-w-sm text-sm text-primary-foreground/85">
                Role-based access and real-time Attendance in one trusted Coop Attendance platform.
              </p>
            </div>
            <p className="text-xs text-primary-foreground/70">Production Attendance Suite</p>
          </div>
          <div className="p-6 sm:p-10">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
