import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuthStatus, useSignIn } from "../../api/auth";
import { ApiError } from "../../api/client";
import { AuthField } from "../../components/account/AuthField";
import { AuthSplit, useDocTitle } from "../../components/account/AuthSplit";
import { safeNext, signupHref } from "../../lib/returnTo";

// The same words for an unknown email and a wrong password, so the page never says whether an account exists.
const SIGN_IN_FAILED = "That email and password don’t match. Check them, or reset your password.";
const TRY_LATER = " Try again in a few minutes.";

function formError(e: unknown): string | null {
  if (!e) return null;
  if (e instanceof ApiError && e.status === 401) return SIGN_IN_FAILED;
  if (e instanceof ApiError && e.status === 429) return SIGN_IN_FAILED + TRY_LATER;
  return e instanceof Error ? e.message : String(e);
}

export function SignInPage() {
  useDocTitle("Sign in");
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const status = useAuthStatus();
  const signIn = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  if (status === "signedIn") return <Navigate to={next ?? "/astrolog"} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (signIn.isPending) return;
    const errs = {
      email: email.trim() ? undefined : "Enter your email.",
      password: password ? undefined : "Enter your password.",
    };
    setErrors(errs);
    if (errs.email || errs.password) {
      signIn.reset();
      (errs.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    signIn.mutate(
      { email: email.trim(), password },
      {
        onError: (err) => {
          // Most often the password was mistyped: put the cursor back there, ready to retype.
          if (err instanceof ApiError && err.status === 401) passwordRef.current?.select();
        },
      },
    );
  };

  const alert = formError(signIn.error);
  return (
    <AuthSplit
      title="Welcome back."
      lede="Sign in to open your AstroLog library and pick up processing where you left off."
      image={{ src: "/landing/m31-960.jpg", width: 960, height: 540, caption: "Andromeda Galaxy (M31), captured by the developer" }}
    >
      {/* method="post": if the script ever failed, the browser would still never put a password in the URL. */}
      <form method="post" noValidate onSubmit={onSubmit} className="auth-form" aria-label="Sign in">
        {alert && (
          <p role="alert" className="auth-alert">
            {alert}
          </p>
        )}
        <AuthField
          id="signin-email"
          label="Email"
          kind="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
          inputRef={emailRef}
        />
        <AuthField
          id="signin-password"
          label="Password"
          kind="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          inputRef={passwordRef}
          aside={
            <Link to="/login/reset-help" className="auth-aside-link">
              Forgot password?
            </Link>
          }
        />
        <button type="submit" className="btn landing-pill landing-cta-primary auth-submit" aria-disabled={signIn.isPending || undefined}>
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="auth-alt">
        New to AstroPlanner? <Link to={next ? signupHref(next) : "/signup"}>Create an account</Link>
      </p>
      <p className="auth-fine">Tonight, Explore and Variable Hunter work without an account.</p>
    </AuthSplit>
  );
}
