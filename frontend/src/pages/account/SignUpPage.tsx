import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { passwordLengthError, useAuthStatus, useSignUp } from "../../api/auth";
import { ApiError } from "../../api/client";
import { AuthField } from "../../components/account/AuthField";
import { AuthSplit, useDocTitle } from "../../components/account/AuthSplit";
import { loginHref, safeNext } from "../../lib/returnTo";

type FieldErrors = { email?: string; password?: string };

export function SignUpPage() {
  useDocTitle("Create account");
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const status = useAuthStatus();
  const signUp = useSignUp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  if (status === "signedIn") return <Navigate to={next ?? "/astrolog"} replace />;

  const show = (errs: FieldErrors) => {
    setErrors(errs);
    if (errs.email) emailRef.current?.focus();
    else if (errs.password) passwordRef.current?.focus();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (signUp.isPending) return;
    // Checked here before any request; the server applies the same rules.
    const errs: FieldErrors = {
      email: email.trim() ? undefined : "Enter your email.",
      password: password ? (passwordLengthError(password) ?? undefined) : "Enter your password.",
    };
    show(errs);
    if (errs.email || errs.password) {
      signUp.reset();
      return;
    }
    signUp.mutate(
      { email: email.trim(), password },
      {
        onError: (err) => {
          // The server's own rule messages ("Enter a valid email address.", "Use at most 1024 characters.") go on their field.
          if (err instanceof ApiError && err.status === 422) {
            show(/email/i.test(err.message) ? { email: err.message } : { password: err.message });
          }
        },
      },
    );
  };

  const err = signUp.error;
  const taken = err instanceof ApiError && err.status === 409;
  const fieldError = err instanceof ApiError && err.status === 422;
  const alert = !err || taken || fieldError ? null : err instanceof ApiError && err.status === 429 ? "Too many attempts from here. Try again in a few minutes." : err.message;

  return (
    <AuthSplit
      title="Keep every night."
      lede="An account holds your AstroLog library, final pictures and processing notes."
      image={{ src: "/landing/eagle.jpg", width: 720, height: 1159, caption: "Eagle Nebula (M16), captured by the developer" }}
    >
      <form method="post" noValidate onSubmit={onSubmit} className="auth-form" aria-label="Create account">
        {taken && (
          <p role="alert" className="auth-alert">
            An account with this email already exists. <Link to={loginHref(next ?? "/astrolog")}>Sign in instead</Link>.
          </p>
        )}
        {alert && (
          <p role="alert" className="auth-alert">
            {alert}
          </p>
        )}
        <AuthField
          id="signup-email"
          label="Email"
          kind="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
          inputRef={emailRef}
        />
        <AuthField
          id="signup-password"
          label="Password"
          kind="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          help="At least 12 characters."
          error={errors.password}
          inputRef={passwordRef}
        />
        <div className="auth-submit-group">
          <button type="submit" className="btn landing-pill landing-cta-primary auth-submit" aria-disabled={signUp.isPending || undefined}>
            {signUp.isPending ? "Creating account…" : "Create account"}
          </button>
          <p className="auth-help">You’ll be signed in right away.</p>
        </div>
        <p className="auth-fine">
          By creating an account you agree to the <Link to="/terms">Terms</Link>. <Link to="/privacy">Privacy</Link> says what is kept and how
          to delete it.
        </p>
      </form>
      <p className="auth-alt">
        Already have an account? <Link to={next ? loginHref(next) : "/login"}>Sign in</Link>
      </p>
    </AuthSplit>
  );
}
