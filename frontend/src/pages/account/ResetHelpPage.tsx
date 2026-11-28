import { Link } from "react-router-dom";
import { AuthSplit, useDocTitle } from "../../components/account/AuthSplit";
import { CONTACT_URL } from "../../lib/contact";

/** "Forgot password?" lands here. The hosted site sends no email, so a reset goes through the developer. */
export function ResetHelpPage() {
  useDocTitle("Reset your password");
  return (
    <AuthSplit
      title="Reset your password."
      lede="AstroPlanner doesn’t send email yet, so there’s no reset link. The developer can reset your password or delete your account."
      image={{ src: "/landing/m31-960.jpg", width: 960, height: 540, caption: "Andromeda Galaxy (M31), captured by the developer" }}
    >
      <p className="auth-body">
        <a href={CONTACT_URL} target="_blank" rel="noreferrer">
          Open an issue on GitHub
        </a>{" "}
        and ask for a private reply. Don’t post your password or email address there: issues are public.
      </p>
      <p className="auth-body">If sign-in was locked after wrong tries, wait 15 minutes and try again.</p>
      <p className="auth-alt">
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthSplit>
  );
}
