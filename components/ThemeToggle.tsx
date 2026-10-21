"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "./Icons";

type Theme = "dark" | "light";
function preferredTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => setTheme(preferredTheme()), []);
  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    localStorage.setItem("nestling:theme", next);
    setTheme(next);
  }
  const nextLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return <button className="theme-toggle" type="button" onClick={toggle} aria-label={nextLabel} title={nextLabel}><span className="theme-toggle-icon">{theme === "dark" ? <Sun/> : <Moon/>}</span><span className="theme-toggle-label">{theme === "dark" ? "Light" : "Dark"}</span></button>;
}
