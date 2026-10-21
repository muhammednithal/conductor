import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary:    { main: "#7c3aed" },
    secondary:  { main: "#06b6d4" },
    background: { default: "#0d1117", paper: "rgba(22,27,42,0.9)" },
    text:       { primary: "#f0f4ff", secondary: "rgba(180,190,220,0.7)" },
    success:    { main: "#22c55e" },
    error:      { main: "#ef4444" },
    warning:    { main: "#f59e0b" },
    info:       { main: "#3b82f6" },
  },
  typography: {
    fontFamily: '"Inter","Roboto","Helvetica","Arial",sans-serif',
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          background: "rgba(22,27,42,0.8)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 16,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 10, textTransform: "none", fontWeight: 600 },
        containedPrimary: {
          background: "linear-gradient(135deg,#4f46e5,#7c3aed)",
          boxShadow: "0 0 20px rgba(124,58,237,0.4)",
          "&:hover": { boxShadow: "0 0 30px rgba(124,58,237,0.6)" },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: "1px solid rgba(255,255,255,0.06)" },
        head: { background: "rgba(255,255,255,0.03)", fontWeight: 700, color: "rgba(180,190,220,0.9)" },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 700, borderRadius: 8 },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { "&:hover": { background: "rgba(255,255,255,0.03)" } },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: "rgba(13,17,23,0.95)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "none",
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 10,
            "& fieldset": { borderColor: "rgba(255,255,255,0.12)" },
            "&:hover fieldset": { borderColor: "rgba(124,58,237,0.5)" },
            "&.Mui-focused fieldset": { borderColor: "#7c3aed" },
          },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          background: "rgba(10,14,26,0.97)",
          backdropFilter: "blur(20px)",
          borderRight: "1px solid rgba(255,255,255,0.07)",
        },
      },
    },
  },
});