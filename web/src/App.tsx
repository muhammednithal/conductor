import { BrowserRouter, Routes, Route, Navigate, NavLink } from "react-router-dom";
import { ThemeProvider, CssBaseline } from "@mui/material";
import {
  AppBar, Toolbar, Typography, Box, Drawer, List,
  ListItemButton, ListItemIcon, ListItemText, Avatar, IconButton, Tooltip,
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

const NAV_ITEMS = [
  { label: "Runs",       icon: <DashboardIcon />,    path: "/runs" },
  { label: "Workflows",  icon: <AccountTreeIcon />,   path: "/workflows" },
  { label: "Builder",    icon: <BuildIcon />,         path: "/workflows/new" },
  { label: "Workers",    icon: <DnsIcon />,           path: "/workers" },
];

function Layout({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  return (
    <Box sx={{ display: "flex" }}>
      {/* Top bar */}
      <AppBar position="fixed" sx={{ zIndex: t => t.zIndex.drawer + 1, background: "linear-gradient(90deg,#1a237e,#283593)" }}>
        <Toolbar>
          <Typography variant="h6" fontWeight={800} letterSpacing={1} sx={{ flexGrow: 1 }}>
            🎼 Conductor
          </Typography>
          <Tooltip title="Sign out">
            <IconButton color="inherit" onClick={logout}><LogoutIcon /></IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      {/* Side nav */}
      <Drawer variant="permanent" sx={{
        width: DRAWER_WIDTH,
        "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box", top: 64, height: "calc(100% - 64px)", borderRight: "1px solid #e0e0e0" },
      }}>
        <List sx={{ pt: 1 }}>
          {NAV_ITEMS.map(item => (
            <ListItemButton
              key={item.path}
              component={NavLink}
              to={item.path}
              end={item.path !== "/workflows/new"}
              sx={{ borderRadius: 2, mx: 1, mb: 0.5,
                "&.active": { bgcolor: "primary.main", color: "#fff", "& .MuiListItemIcon-root": { color: "#fff" } },
                "&:not(.active):hover": { bgcolor: "grey.100" },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      {/* Main content */}
      <Box component="main" sx={{ flexGrow: 1, mt: "64px", ml: `${DRAWER_WIDTH}px`, minHeight: "calc(100vh - 64px)", bgcolor: "background.default" }}>
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
      <Route path="/runs" element={<Protected><RunsListPage /></Protected>} />
      <Route path="/runs/:id" element={<Protected><RunDetailPage /></Protected>} />
      <Route path="/workflows" element={<Protected><WorkflowsListPage /></Protected>} />
      <Route path="/workflows/new" element={<Protected><WorkflowBuilderPage /></Protected>} />
      <Route path="/workers" element={<Protected><WorkersPage /></Protected>} />
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