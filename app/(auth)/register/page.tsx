"use client";

import { useState } from "react";
import Link from "next/link";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        setLoading(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="auth-container bg-mesh">
        <div className="auth-card" style={{ animation: "slideUp 0.5s ease", textAlign: "center" }}>
          <div style={{ fontSize: "64px", marginBottom: "16px" }}>🎉</div>
          <h2 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "12px" }}>
            Registration Successful!
          </h2>
          <p style={{ color: "var(--color-text-muted)", fontSize: "14px", lineHeight: 1.6, marginBottom: "24px" }}>
            আপনার একাউন্ট তৈরি হয়েছে। Admin approval-এর জন্য অপেক্ষা করুন।
            Approve হলে আপনি login করে dashboard অ্যাক্সেস করতে পারবেন।
          </p>
          <Link href="/login" className="btn btn-primary btn-lg" style={{ width: "100%" }}>
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container bg-mesh">
      <div className="auth-card" style={{ animation: "slideUp 0.5s ease" }}>
        <div className="auth-logo">
          <span>🐸</span>
          <span>PepeShops</span>
        </div>
        <p className="auth-subtitle">
          Create your account — admin approval required
        </p>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: "16px" }}>
            <span>⚠️</span> {error}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="register-name" className="input-label">
              Full Name
            </label>
            <input
              id="register-name"
              type="text"
              className="input"
              placeholder="Your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="input-group">
            <label htmlFor="register-email" className="input-label">
              Email
            </label>
            <input
              id="register-email"
              type="email"
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="register-password" className="input-label">
              Password
            </label>
            <input
              id="register-password"
              type="password"
              className="input"
              placeholder="Minimum 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading}
            style={{ width: "100%", marginTop: "8px" }}
          >
            {loading ? (
              <>
                <span className="spinner" /> Creating account...
              </>
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account?{" "}
          <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
