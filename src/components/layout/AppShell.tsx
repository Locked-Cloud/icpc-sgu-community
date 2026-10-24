import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  Terminal,
  User,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useMarkRead, useNotificationRealtime, useNotifications } from "@/hooks/useNotifications";
import { APP_NAME, APP_TAGLINE, ADMIN_NAV, STUDENT_NAV } from "@/lib/constants";
import { cn, initials, timeAgo } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { NOTIFICATION_KIND_LABELS } from "@/lib/constants";

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Terminal className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{APP_NAME}</p>
          <p className="truncate text-[11px] text-muted-foreground">{APP_TAGLINE}</p>
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1 px-2 py-3">
        <nav className="space-y-1">
          {STUDENT_NAV.map((item) => (
            <SidebarLink key={item.to} to={item.to} label={item.label} icon={item.icon} onNavigate={onNavigate} />
          ))}
        </nav>
        {isAdmin && (
          <>
            <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Administration
            </p>
            {ADMIN_NAV.map((section) => (
              <div key={section.section} className="mb-2">
                <p className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground/70">{section.section}</p>
                <nav className="space-y-1">
                  {section.items.map((item) => (
                    <SidebarLink
                      key={item.to}
                      to={item.to}
                      label={item.label}
                      icon={item.icon}
                      onNavigate={onNavigate}
                    />
                  ))}
                </nav>
              </div>
            ))}
          </>
        )}
      </ScrollArea>
    </div>
  );
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: typeof Bell;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/dashboard" || to === "/admin"}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function NotificationsBell() {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const unread = data?.filter((n) => n.read_at == null).length ?? 0;

  useNotificationRealtime(profile?.id, () => {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-4.5 w-4.5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markRead.mutate({ all: true })}
            >
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-80">
          {!data || data.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            <div className="divide-y">
              {data.slice(0, 15).map((n) => (
                <button
                  key={n.id}
                  className={cn(
                    "block w-full px-3 py-2.5 text-left transition-colors hover:bg-accent",
                    !n.read_at && "bg-primary/5",
                  )}
                  onClick={() => {
                    markRead.mutate({ id: n.id });
                    if (n.link) navigate(n.link);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn("text-[13px] leading-snug", !n.read_at && "font-medium")}>{n.title}</p>
                    {n.link && (
                      <span className="shrink-0 text-[11px] text-primary">Open</span>
                    )}
                  </div>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    {NOTIFICATION_KIND_LABELS[n.kind] ?? n.kind} · {timeAgo(n.created_at)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const { profile, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5">
          <Avatar className="h-7 w-7">
            {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
            <AvatarFallback className="text-xs">{initials(profile?.full_name_en ?? "?")}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-28 truncate text-sm sm:inline">{profile?.full_name_en}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Signed in as {profile?.full_name_en}
          <br />
          {profile?.role === "admin" ? "Administrator" : "Student"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/profile")}>
          <User /> My profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/settings")}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={toggle}>
          {theme === "dark" ? <Sun /> : <Moon />} {theme === "dark" ? "Light" : "Dark"} theme
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()} className="text-destructive focus:text-destructive">
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-card/50 lg:block">
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur sm:px-5">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <p className="truncate text-sm font-medium text-muted-foreground">
            {location.pathname.startsWith("/admin") ? "Administration" : "Level 1 Platform"}
          </p>

          <div className="ml-auto flex items-center gap-1">
            <NotificationsBell />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6" key={location.pathname}>
          <Outlet />
        </main>

        <footer className="border-t px-4 py-3 text-center text-[11px] text-muted-foreground/60">
          {APP_NAME} — Level 1 Management Platform · {APP_TAGLINE}
        </footer>
      </div>
    </div>
  );
}
