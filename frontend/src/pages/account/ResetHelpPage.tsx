import { Link } from "react-router-dom";
import { AuthSplit, useDocTitle } from "../../components/account/AuthSplit";

const COMMAND = "cd backend && .venv/bin/python -m app.accounts reset-password you@example.com";

/** "Forgot password?" lands here: there is no email sender, so a password is reset from the terminal. */
export function ResetHelpPage() {
  useDocTitle("Reset your password");
  return (
    <AuthSplit
      title="Reset your password."
      lede="AstroPlanner runs on your computer, so a password is reset from the terminal:"
      image={{ src: "/landing/m31-960.jpg", width: 960, height: 540, caption: "Andromeda Galaxy (M31), captured by the developer" }}
    >
      <pre className="auth-code">
        <code translate="no">{COMMAND}</code>
      </pre>
      <p className="auth-body">It asks for the new password twice, then signs out every device.</p>
      {/* The command cannot clear the running server's in-memory lockout. */}
      <p className="auth-body">If sign-in was locked after wrong tries, wait 15 minutes or restart the backend.</p>
      <p className="auth-alt">
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthSplit>
  );
}
