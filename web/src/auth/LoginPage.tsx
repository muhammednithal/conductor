import { useState, FormEvent } from "react";
import {
  Box, Card, CardContent, TextField, Button,
  Typography, Tab, Tabs, Alert, CircularProgress,
} from "@mui/material";
import { useAuth } from "./AuthContext";
import { api } from "../api/client";

export function LoginPage() {
  const { login } = useAuth();
  const [tab, setTab] = useState(0); // 0=login, 1=register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const fn = tab === 0 ? api.login : api.register;
      const { token } = await fn(email, password);
      login(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
      <Card sx={{ width: 420, mx: 2 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" align="center" gutterBottom>
            🎼 Conductor
          </Typography>
          <Typography variant="body2" align="center" color="text.secondary" mb={3}>
            AI Workflow Orchestrator
          </Typography>

          <Tabs value={tab} onChange={(_, v) => { setTab(v); setError(""); }} variant="fullWidth" sx={{ mb: 3 }}>
            <Tab label="Sign In" />
            <Tab label="Register" />
          </Tabs>

          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              label="Email" type="email" fullWidth required
              value={email} onChange={e => setEmail(e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              label="Password" type="password" fullWidth required
              value={password} onChange={e => setPassword(e.target.value)}
              sx={{ mb: 2 }}
            />
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <Button type="submit" variant="contained" fullWidth size="large" disabled={loading}>
              {loading ? <CircularProgress size={22} color="inherit" /> : tab === 0 ? "Sign In" : "Create Account"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}