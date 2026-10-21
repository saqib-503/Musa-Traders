"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useRef,useState,type FormEvent} from "react";
import {sb,isSupabaseConfigured} from "@/lib/supabase";
import {errorMessage} from "@/lib/utils";
import {ButtonContent} from "./Loading";
import styles from "./AuthForm.module.css";

export default function AuthForm({mode}:{mode:"login"|"signup"}){
  const signup=mode==="signup";
  const router=useRouter();
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[name,setName]=useState("");
  const [visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[confirmation,setConfirmation]=useState(false),[showSignupHint,setShowSignupHint]=useState(false);
  const locked=useRef(false);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(locked.current||!isSupabaseConfigured)return;
    setError("");setMessage("");setShowSignupHint(false);
    if(signup&&!name.trim()){setError("Please enter your full name.");return;}
    if(signup&&password!==confirm){setError("Passwords do not match.");return;}
    locked.current=true;setBusy(true);
    try{
      const result=signup
        ?await sb.auth.signUp({email:email.trim(),password,options:{data:{full_name:name.trim()},emailRedirectTo:`${window.location.origin}/account`}})
        :await sb.auth.signInWithPassword({email:email.trim(),password});
      if(result.error)throw result.error;
      setPassword("");setConfirm("");
      if(signup&&!result.data.session){setConfirmation(true);return;}
      if(result.data.session){
        setMessage("Signed in. Opening your dashboard...");
        const access=await sb.rpc("is_admin");
        const next = new URLSearchParams(window.location.search).get("next");
        const safeNext = next && /^\/(?:product\/[^?#]+|category\/[^?#]+|cart|wishlist|checkout)?(?:[?#].*)?$/.test(next) && !next.includes("\\") ? next : null;
        router.replace(safeNext || (!access.error&&access.data===true?"/admin":"/"));
      }
    }catch(e){
      const text=errorMessage(e);
      const invalidLogin=!signup&&(/invalid login credentials/i.test(text)||(typeof e==="object"&&e!==null&&"code" in e&&(e as {code?:string}).code==="invalid_credentials"));
      setError(invalidLogin?"Invalid login credentials.":text);
      setShowSignupHint(invalidLogin);
    }
    finally{locked.current=false;setBusy(false);}
  }

  return <main className={styles.page}>
    <Link href="/" className={styles.back}><span aria-hidden="true">←</span> Back to store</Link>
    <div className={styles.panel}>
      <aside className={styles.story}>
        <span className={styles.eyebrow}>A LITTLE WORLD OF CARE</span>
        <h2>For their little world.<br/> <span>And yours.</span></h2>
        <p>Thoughtful essentials for little ones.<br/>A little less to worry about for you.</p>
        <div className={styles.art} aria-hidden="true"><div className={styles.orbit}/><span className={styles.starOne}>✦</span><span className={styles.starTwo}>✧</span><div className={styles.teddy}>🧸</div><span className={styles.artTag}>Little things. Lots of love.</span></div>
        <div className={styles.perks}><span>♡ Save your favourites</span><span>↗ Follow your orders</span></div>
      </aside>
      <section className={styles.formSide} aria-labelledby="auth-title">
        <nav className={styles.tabs} aria-label="Account access"><Link href="/login" aria-current={!signup?"page":undefined}>Login</Link><Link href="/signup" aria-current={signup?"page":undefined}>Sign up</Link></nav>
        {confirmation?<div className={styles.confirmation}>
          <div className={styles.mailIcon} aria-hidden="true">✉</div><h1 id="auth-title">Check your inbox</h1>
          <p role="status">Check your email to confirm your account. Follow the confirmation link sent to <strong>{email.trim()}</strong>.</p>
          <p className={styles.hint}>If it hasn’t arrived, check your spam folder. If you already have an account, you can sign in below.</p>
          <Link className={styles.submit} href="/login">Back to login <span aria-hidden="true">→</span></Link>
          <button className={styles.textButton} onClick={()=>{setConfirmation(false);setError("");}}>Use a different email</button>
        </div>:<>
          <div className={styles.heading}><span className={styles.eyebrow}>{signup?"JOIN MUSA TRADERS":"YOUR MUSA TRADERS ACCOUNT"}</span><h1 id="auth-title">{signup?"Create your account":"Welcome back"}</h1><p>{signup?"A few details, and you’re ready to shop.":"Your saved items and orders await."}</p></div>
          {!isSupabaseConfigured?<p className={styles.notice} role="status">Sign in and account creation will be available once the store is connected.</p>:<form onSubmit={submit}>
            <fieldset disabled={busy} className={styles.fields}>
              {signup&&<div className={styles.field}><label htmlFor="auth-name">Full name</label><input id="auth-name" name="name" autoComplete="name" required maxLength={120} placeholder="Your full name" value={name} onChange={e=>setName(e.target.value)}/></div>}
              <div className={styles.field}><label htmlFor="auth-email">Email</label><input id="auth-email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/></div>
              <div className={styles.field}><div className={styles.labelRow}><label htmlFor="auth-password">Password</label>{!signup&&<Link href="/reset-password">Forgot password?</Link>}</div><div className={styles.password}><input id="auth-password" name="password" type={visible?"text":"password"} autoComplete={signup?"new-password":"current-password"} required minLength={signup?8:undefined} aria-describedby={signup?"password-help":undefined} placeholder={signup?"Create a password":"Enter your password"} value={password} onChange={e=>setPassword(e.target.value)}/><button type="button" aria-label={visible?"Hide password":"Show password"} aria-pressed={visible} onClick={()=>setVisible(v=>!v)}>{visible?"Hide":"Show"}</button></div>{signup&&<p id="password-help" className={styles.hint}>Use at least 8 characters.</p>}</div>
              {signup&&<div className={styles.field}><label htmlFor="auth-confirm">Confirm password</label><input id="auth-confirm" name="confirm-password" type={visible?"text":"password"} autoComplete="new-password" required minLength={8} placeholder="Enter your password again" value={confirm} onChange={e=>setConfirm(e.target.value)}/></div>}
              {error&&<><p className={styles.error} role="alert">{error}</p>{showSignupHint&&<p className={styles.hint}>No account yet? <Link href="/signup">Create a new account</Link>.</p>}</>}{message&&<p className={styles.notice} role="status">{message}</p>}
              <button className={styles.submit} type="submit" disabled={busy}><ButtonContent busy={busy} busyLabel={signup?"Creating account...":"Signing in..."}>{signup?"Create account":"Sign in"}</ButtonContent>{!busy&&<span aria-hidden="true">→</span>}</button>
            </fieldset>
          </form>}
          <p className={styles.switch}>{signup?"Already have an account?":"New to Musa Traders?"} <Link href={signup?"/login":"/signup"}>{signup?"Sign in":"Create an account"}</Link></p>
          <div className={styles.privacy}><svg aria-hidden="true" width="14" height="16" viewBox="0 0 20 22" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="9" width="14" height="11" rx="3"/><path d="M6 9V6a4 4 0 0 1 8 0v3"/></svg> Your account, your little world.</div>
        </>}
      </section>
    </div>
  </main>;
}
