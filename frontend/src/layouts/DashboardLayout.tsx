import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarCheck2,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Vote,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useVoterImport } from "@/hooks/useVoterImport";
import type { UserRole } from "@/api/types";
import coopVoteLogo from "@/assets/coop-vote-logo-cropped.png";

interface NavItem {
  label: string;
  path: string;
  roles: UserRole[];
  icon: LucideIcon;
  children?: Array<{
    label: string;
    path: string;
  }>;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Ballot", path: "/elections/active", roles: ["voter"], icon: Vote },
  { label: "Dashboard", path: "/admin/dashboard", roles: ["super_admin", "election_admin"], icon: LayoutDashboard },
  {
    label: "Attendance",
    path: "/admin/attendance",
    roles: ["super_admin", "election_admin"],
    icon: CalendarCheck2,
    children: [
      { label: "Attendance Records", path: "/admin/attendance/records" },
    ],
  },
  {
    label: "Settings",
    path: "/admin/settings",
    roles: ["super_admin", "election_admin"],
    icon: Settings,
    children: [
      { label: "ID Template", path: "/admin/settings/id-template" },
    ],
  },
];

function roleLabel(role: UserRole) {
  return role.replace("_", " ");
}

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const {
    status: voterImportStatus,
    progress: voterImportProgress,
    fileName: voterImportFileName,
    message: voterImportMessage,
    processed: voterImportProcessed,
    total: voterImportTotal,
    isImporting: isVoterImporting,
    clearState: clearVoterImportState,
  } = useVoterImport();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [expandedSubmenus, setExpandedSubmenus] = useState<Record<string, boolean>>({});

  if (!user) {
    return null;
  }

  const homePath = user.role === "voter" ? "/elections/active" : "/admin/dashboard";
  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const visibleLeafNav = visibleNav.flatMap((item) =>
    item.children && item.children.length > 0
      ? [{ label: item.label, path: item.path }, ...item.children.map((child) => ({ label: child.label, path: child.path }))]
      : [{ label: item.label, path: item.path }]
  );

  const exact = visibleLeafNav.find((item) => item.path === location.pathname);
  const nested = visibleLeafNav.find((item) => location.pathname.startsWith(item.path));
  const pageTitle = exact?.label ?? nested?.label ?? "Dashboard";
  const isVotingOnlyRoute = /^\/voting\/\d+$/.test(location.pathname);
  const showVoterImportBanner =
    (user.role === "super_admin" || user.role === "election_admin") &&
    (isVoterImporting || voterImportStatus === "success" || voterImportStatus === "error");
  const voterImportTitle = isVoterImporting
    ? voterImportStatus === "processing"
      ? "Processing Voter Import..."
      : "Uploading Voter Import..."
    : voterImportStatus === "success"
      ? "Voter Import Complete"
      : "Voter Import Failed";
  const voterImportToneClass =
    voterImportStatus === "error"
      ? "border-rose-300 bg-rose-50 text-rose-800"
      : voterImportStatus === "success"
        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
        : "border-sky-300 bg-sky-50 text-sky-800";

  useEffect(() => {
    const activeParent = visibleNav.find(
      (item) => item.children && item.children.length > 0 && location.pathname.startsWith(item.path)
    );

    if (!activeParent) {
      return;
    }

    setExpandedSubmenus((current) => {
      if (Object.prototype.hasOwnProperty.call(current, activeParent.path)) {
        return current;
      }

      return {
        ...current,
        [activeParent.path]: true,
      };
    });
  }, [location.pathname, visibleNav]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  if (isVotingOnlyRoute) {
    return (
      <div className="min-h-screen app-shell-bg">
        <main className="px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <div className="mx-auto max-w-[1200px] animate-fade-up">
            <Outlet />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen app-shell-bg">
      {mobileSidebarOpen ? (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-[#11142d]/40 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed left-0 top-0 z-50 h-screen w-[270px] border-r bg-card shadow-card transition-all duration-200 md:translate-x-0 ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${desktopSidebarCollapsed ? "md:w-[88px]" : "md:w-[270px]"}`}
      >
        <div className={`flex h-[70px] items-center border-b ${desktopSidebarCollapsed ? "justify-center px-2" : "justify-between px-6"}`}>
          <Link
            to={homePath}
            className={`inline-flex min-w-0 items-center gap-2 text-lg font-bold text-foreground ${
              desktopSidebarCollapsed ? "md:justify-center" : "flex-1"
            }`}
            onClick={() => setMobileSidebarOpen(false)}
            title="Coop Vote"
          >
            <img
              src={coopVoteLogo}
              alt=""
              aria-hidden="true"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
              className={`rounded bg-white/95 p-0.5 ${desktopSidebarCollapsed ? "h-7 w-7 object-cover object-left" : "h-9 w-auto shrink-0"}`}
            />
            <span className={`truncate whitespace-nowrap ${desktopSidebarCollapsed ? "md:hidden" : ""}`}>Coop Vote</span>
          </Link>
          <button
            aria-label="Close navigation"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex h-[calc(100vh-70px)] flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-5">
            <p className={`mb-3 px-3 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground ${desktopSidebarCollapsed ? "md:hidden" : ""}`}>
              Menu
            </p>
            <nav className="space-y-1">
              {visibleNav.map((item, index) => {
                const Icon = item.icon;
                const hasChildren = Boolean(item.children && item.children.length > 0);
                const isParentActive = location.pathname.startsWith(item.path);
                const isExpanded = hasChildren
                  ? (Object.prototype.hasOwnProperty.call(expandedSubmenus, item.path)
                      ? expandedSubmenus[item.path]
                      : isParentActive)
                  : false;

                if (hasChildren) {
                  return (
                    <div key={item.path} className="space-y-1">
                      <button
                        type="button"
                        title={desktopSidebarCollapsed ? item.label : undefined}
                        onClick={() => {
                          const shouldNavigateToParent = location.pathname !== item.path;

                          if (desktopSidebarCollapsed) {
                            if (shouldNavigateToParent) {
                              void navigate(item.path);
                            }
                            setMobileSidebarOpen(false);
                            return;
                          }

                          setExpandedSubmenus((current) => ({
                            ...current,
                            [item.path]: !isExpanded,
                          }));

                          if (shouldNavigateToParent) {
                            void navigate(item.path);
                            setMobileSidebarOpen(false);
                          }
                        }}
                        className={`group flex w-full items-center rounded-[9px] px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                          isParentActive
                            ? "bg-primary !text-primary-foreground shadow-sm hover:bg-primary/95 hover:!text-primary-foreground"
                            : "!text-foreground hover:bg-secondary hover:!text-primary"
                        } ${desktopSidebarCollapsed ? "md:justify-center md:px-2" : "justify-between"} ${index < 2 ? "animate-slide-in-left" : ""}`}
                      >
                        <span className="inline-flex items-center gap-2.5">
                          <Icon className="h-4 w-4" />
                          <span className={desktopSidebarCollapsed ? "md:hidden" : ""}>{item.label}</span>
                        </span>
                        {desktopSidebarCollapsed ? null : (
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : "rotate-0"}`}
                          />
                        )}
                      </button>

                      {!desktopSidebarCollapsed && isExpanded ? (
                        <div className="ml-5 space-y-1 border-l border-border/70 pl-3">
                          {item.children?.map((child) => (
                            <NavLink
                              key={child.path}
                              to={child.path}
                              onClick={() => setMobileSidebarOpen(false)}
                              className={({ isActive }) =>
                                `block rounded-[8px] px-3 py-2 text-sm font-medium transition-all ${
                                  isActive ? "bg-secondary text-primary" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                                }`
                              }
                            >
                              {child.label}
                            </NavLink>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                }

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileSidebarOpen(false)}
                    title={desktopSidebarCollapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      `group flex items-center rounded-[9px] px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? "bg-primary !text-primary-foreground shadow-sm hover:bg-primary/95 hover:!text-primary-foreground"
                          : "!text-foreground hover:bg-secondary hover:!text-primary"
                      } ${desktopSidebarCollapsed ? "md:justify-center md:px-2" : "justify-between"} ${index < 2 ? "animate-slide-in-left" : ""}`
                    }
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <Icon className="h-4 w-4" />
                      <span className={desktopSidebarCollapsed ? "md:hidden" : ""}>{item.label}</span>
                    </span>
                    <ChevronRight className={`h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100 ${desktopSidebarCollapsed ? "md:hidden" : ""}`} />
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div className="border-t p-4">
            <div className="rounded-lg bg-muted p-3">
              <p className={`truncate text-sm font-semibold ${desktopSidebarCollapsed ? "md:hidden" : ""}`}>{user.name}</p>
              <p className={`mt-0.5 text-xs text-muted-foreground ${desktopSidebarCollapsed ? "md:hidden" : ""}`}>
                {user.email ?? user.voter_id ?? "-"}
              </p>
              <div className={`mt-3 flex items-center ${desktopSidebarCollapsed ? "justify-center" : "justify-between"}`}>
                <Badge variant="secondary" className={`capitalize ${desktopSidebarCollapsed ? "hidden" : ""}`}>
                  {roleLabel(user.role)}
                </Badge>
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className={`transition-[padding] duration-200 ${desktopSidebarCollapsed ? "md:pl-[88px]" : "md:pl-[270px]"}`}>
        <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
          <div className="flex h-[70px] items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                aria-label="Open navigation"
                className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] border bg-card text-foreground transition hover:bg-muted md:hidden"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </button>
              <button
                aria-label={desktopSidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
                className="hidden h-9 w-9 items-center justify-center rounded-[9px] border bg-card text-foreground transition hover:bg-muted md:inline-flex"
                onClick={() => setDesktopSidebarCollapsed((current) => !current)}
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Coop Vote
                </p>
                <h1 className="text-lg font-bold text-foreground">{pageTitle}</h1>
              </div>
            </div>
            <div className="hidden items-center gap-3 sm:flex">
              <Badge variant="outline" className="capitalize text-muted-foreground">
                {roleLabel(user.role)}
              </Badge>
            </div>
          </div>
        </header>
        {showVoterImportBanner ? (
          <div className="border-b bg-card px-4 py-3 sm:px-6 lg:px-8">
            <div className={`mx-auto max-w-[1400px] rounded-[10px] border px-3 py-2 ${voterImportToneClass}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{voterImportTitle}</p>
                  <p className="text-xs opacity-90">
                    {voterImportFileName ? `File: ${voterImportFileName}` : "Voter import file"}
                  </p>
                  {isVoterImporting ? (
                    <>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/70">
                        <div
                          className="h-full bg-current transition-[width] duration-150 ease-out"
                          style={{ width: `${voterImportProgress}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs">
                        {voterImportStatus === "processing"
                          ? voterImportTotal > 0
                            ? `Processing records... ${voterImportProgress}% (${voterImportProcessed}/${voterImportTotal})`
                            : `Processing records... ${voterImportProgress}%`
                          : `Uploading... ${voterImportProgress}%`}
                      </p>
                    </>
                  ) : voterImportMessage ? (
                    <p className="mt-1 text-xs">{voterImportMessage}</p>
                  ) : null}
                </div>
                {!isVoterImporting ? (
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-black/10"
                    aria-label="Dismiss voter import status"
                    onClick={clearVoterImportState}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <main className="px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <div className="mx-auto max-w-[1400px] animate-fade-up">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
