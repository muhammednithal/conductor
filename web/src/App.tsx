import { BrowserRouter, Routes, Route, Navigate, NavLink } from "react-router-dom";
import { ThemeProvider, CssBaseline } from "@mui/material";
import {
  AppBar, Toolbar, Typography, Box, Drawer, List,
  ListItemButton, ListItemIcon, ListItemText, Tooltip,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import BuildIcon from "@mui/icons-material/Build";
import DnsIcon from "@mui/icons-material/Dns";
import LogoutIcon from "@mui/icons-material/Logout";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { WorkflowsListPage } from "./workflows/WorkflowsListPage";
import { WorkflowBuilderPage } from "./workflows/WorkflowBuilderPage";
import { RunsListPage } from "./runs/RunsListPage";
import { RunDetailPage } from "./runs/RunDetailPage";
import { WorkersPage } from "./workers/WorkersPage";
import { theme } from "./theme";

const DRAWER_WIDTH = 220;
const BG = "#0d1117";

const NAV = [
  { label:"Runs",      icon:<DashboardIcon />,  path:"/runs" },
  { label:"Workflows", icon:<AccountTreeIcon />, path:"/workflows" },
  { label:"Builder",   icon:<BuildIcon />,       path:"/workflows/new" },
  { label:"Workers",   icon:<DnsIcon />,         path:"/workers" },
];

function Sidebar() {
  const { logout } = useAuth();
  return (
    <Drawer variant="permanent" sx={{
      width: DRAWER_WIDTH,
      "& .MuiDrawer-paper": {
        width: DRAWER_WIDTH, top: 64, height: "calc(100% - 64px)",
        background: "rgba(10,14,26,0.97)",
        borderRight: "1px solid rgba(255,255,255,0.07)",
      },
    }}>
      <List sx={{ pt: 2, px: 1 }}>
        {NAV.map(item => (
          <ListItemButton
            key={item.path}
            component={NavLink}
            to={item.path}
            end={item.path !== "/workflows/new"}
            sx={{
              borderRadius: 2, mb: 0.5, px: 2, py: 1.2,
              color: "rgba(180,190,220,0.7)",
              transition: "all 0.2s",
              "&.active": {
                background: "linear-gradient(135deg,rgba(79,70,229,0.25),rgba(124,58,237,0.15))",
                color: "#c4b5fd",
                border: "1px solid rgba(124,58,237,0.3)",
                boxShadow: "0 0 16px rgba(124,58,237,0.15)",
                "& .MuiListItemIcon-root": { color: "#c4b5fd" },
              },
              "&:not(.active):hover": {
                background: "rgba(255,255,255,0.04)",
                color: "#fff",
                "& .MuiListItemIcon-root": { color: "#fff" },
              },
              "& .MuiListItemIcon-root": { color:"rgba(180,190,220,0.5)", minWidth:36 },
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight:600, fontSize:14 }} />
          </ListItemButton>
        ))}
      </List>

      <Box sx={{ mt:"auto", p:2, borderTop:"1px solid rgba(255,255,255,0.06)" }}>
        <Tooltip title="Sign out" placement="right">
          <ListItemButton
            onClick={() => useAuth}
            sx={{ borderRadius:2, color:"rgba(248,113,113,0.7)",
              "&:hover":{ background:"rgba(239,68,68,0.1)", color:"#f87171" } }}
          >
            <ListItemIcon sx={{ minWidth:36, color:"inherit" }}><LogoutIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="Sign out" primaryTypographyProps={{ fontSize:13, fontWeight:600 }} />
          </ListItemButton>
        </Tooltip>
      </Box>
    </Drawer>
  );
}

function SignOutButton() {
  const { logout } = useAuth();
  return (
    <Tooltip title="Sign out" placement="right">
      <ListItemButton
        onClick={logout}
        sx={{ borderRadius:2, color:"rgba(248,113,113,0.7)",
          "&:hover":{ background:"rgba(239,68,68,0.1)", color:"#f87171" } }}
      >
        <ListItemIcon sx={{ minWidth:36, color:"inherit" }}><LogoutIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Sign out" primaryTypographyProps={{ fontSize:13, fontWeight:600 }} />
      </ListItemButton>
    </Tooltip>
  );
}

function SidebarWithLogout() {
  return (
    <Drawer variant="permanent" sx={{
      width: DRAWER_WIDTH,
      "& .MuiDrawer-paper": {
        width: DRAWER_WIDTH, top: 64, height: "calc(100% - 64px)",
        background: "rgba(10,14,26,0.97)",
        borderRight: "1px solid rgba(255,255,255,0.07)",
      },
    }}>
      <List sx={{ pt: 2, px: 1 }}>
        {NAV.map(item => (
          <ListItemButton
            key={item.path}
            component={NavLink}
            to={item.path}
            end={item.path !== "/workflows/new"}
            sx={{
              borderRadius: 2, mb: 0.5, px: 2, py: 1.2,
              color: "rgba(180,190,220,0.7)", transition: "all 0.2s",
              "&.active": {
                background: "linear-gradient(135deg,rgba(79,70,229,0.25),rgba(124,58,237,0.15))",
                color: "#c4b5fd", border: "1px solid rgba(124,58,237,0.3)",
                boxShadow: "0 0 16px rgba(124,58,237,0.15)",
                "& .MuiListItemIcon-root": { color: "#c4b5fd" },
              },
              "&:not(.active):hover": {
                background: "rgba(255,255,255,0.04)", color: "#fff",
                "& .MuiListItemIcon-root": { color: "#fff" },
              },
              "& .MuiListItemIcon-root": { color:"rgba(180,190,220,0.5)", minWidth:36 },
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight:600, fontSize:14 }} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ mt:"auto", p:2, borderTop:"1px solid rgba(255,255,255,0.06)" }}>
        <SignOutButton />
      </Box>
    </Drawer>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display:"flex", minHeight:"100vh", background: BG }}>
      <AppBar position="fixed" sx={{ zIndex: t => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <Typography variant="h6" sx={{
            flexGrow:1, fontWeight:800, letterSpacing:2,
            background:"linear-gradient(90deg,#c4b5fd,#67e8f9)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
          }}>
            CONDUCTOR
          </Typography>
        </Toolbar>
      </AppBar>

      <SidebarWithLogout />

      {/* Main content — explicit background so nothing bleeds through */}
      <Box component="main" sx={{
        flexGrow: 1,
        mt: "64px",
        ml: `${DRAWER_WIDTH}px`,
        minHeight: "calc(100vh - 64px)",
        background: BG,    // ← hardcoded, no theme token
        overflow: "hidden",
      }}>
        {children}
      </Box>
    </Box>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  return token ? <Layout>{children}</Layout> : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/runs" replace /> : <LoginPage />} />
      <Route path="/runs"          element={<Protected><RunsListPage /></Protected>} />
      <Route path="/runs/:id"      element={<Protected><RunDetailPage /></Protected>} />
      <Route path="/workflows"     element={<Protected><WorkflowsListPage /></Protected>} />
      <Route path="/workflows/new" element={<Protected><WorkflowBuilderPage /></Protected>} />
      <Route path="/workers"       element={<Protected><WorkersPage /></Protected>} />
      <Route path="*" element={<Navigate to={token ? "/runs" : "/login"} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}