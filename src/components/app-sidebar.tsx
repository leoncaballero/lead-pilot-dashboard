import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard,
  Inbox,
  FileSearch,
  History,
  BarChart3,
  Activity,
  Settings,
  Plane,
  FileText,
  Columns3,
  Trophy,
  Workflow,
  GraduationCap,
  Bot,
  Search,
  HeartPulse,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const mainItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Triage", url: "/triage", icon: Inbox },
  { title: "Pipeline", url: "/pipeline", icon: Columns3 },
  { title: "Deep Review", url: "/deep-review", icon: FileSearch },
  { title: "History", url: "/history", icon: History },
];

const insightsItems = [
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Auto-send Monitor", url: "/auto-send-monitor", icon: Bot },
  { title: "Prompt Performance", url: "/prompt-performance", icon: Trophy },
  { title: "Activity", url: "/activity", icon: Activity },
];

const systemItems = [
  { title: "Prompts", url: "/prompts", icon: FileText },
  { title: "AI Coach", url: "/training", icon: GraduationCap },
  { title: "Estrategias", url: "/strategies", icon: Workflow },
  { title: "System Health", url: "/system-health", icon: HeartPulse },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (path: string) => currentPath === path;
  const navigate = useNavigate();
  const [searchEmail, setSearchEmail] = useState("");

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = searchEmail.trim().toLowerCase();
    if (!v) return;
    navigate({
      to: "/lead/$email",
      params: { email: encodeURIComponent(v) },
    });
    setSearchEmail("");
  }

  const renderItems = (items: typeof mainItems) => (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.url}>
          <SidebarMenuButton asChild isActive={isActive(item.url)}>
            <Link to={item.url} className="flex items-center gap-2">
              <item.icon className="h-4 w-4" />
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/dashboard" className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Plane className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Setting Pilot</span>
            <span className="text-xs text-muted-foreground">Pipeline Control</span>
          </div>
        </Link>
        <form onSubmit={onSearchSubmit} className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="email"
              placeholder="Buscar lead por email…"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              className="h-8 pl-7 text-xs"
            />
          </div>
        </form>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Pipeline</SidebarGroupLabel>
          <SidebarGroupContent>{renderItems(mainItems)}</SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Insights</SidebarGroupLabel>
          <SidebarGroupContent>{renderItems(insightsItems)}</SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>{renderItems(systemItems)}</SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
