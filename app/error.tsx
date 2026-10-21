"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main><h1>Something went wrong</h1><p>We could not load this page. Please try again.</p>
    <button className="btn" onClick={reset}>Try again</button></main>;
}
