import { useState, FormEvent } from "react";
import { useAuth } from "./AuthContext";
import { api } from "../api/client";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const { token } = await api.login(email, password);
      login(token);
    } catch {
      setError("Invalid email or password");
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
      <h1>Conductor</h1>
      <form onSubmit={handleSubmit}>
        <div><label>Email<br /><input value={email} onChange={e => setEmail(e.target.value)} type="email" required /></label></div>
        <div style={{ marginTop: 12 }}><label>Password<br /><input value={password} onChange={e => setPassword(e.target.value)} type="password" required /></label></div>
        {error && <p style={{ color: "red" }}>{error}</p>}
        <button style={{ marginTop: 16 }} type="submit">Sign in</button>
      </form>
    </div>
  );
}