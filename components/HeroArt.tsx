"use client";

import {useEffect,useRef,type PointerEvent} from "react";
import styles from "./HeroArt.module.css";

export default function HeroArt(){
  const scene=useRef<HTMLDivElement>(null);
  const frame=useRef<number|null>(null);
  const reducedMotion=useRef(true);

  function reset(){
    if(frame.current!==null)cancelAnimationFrame(frame.current);
    frame.current=null;
    scene.current?.style.setProperty("--tilt-x","0deg");
    scene.current?.style.setProperty("--tilt-y","0deg");
  }

  useEffect(()=>{
    const node=scene.current;
    if(!node)return;
    const preference=window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference=()=>{reducedMotion.current=preference.matches;if(preference.matches)reset();};
    syncPreference();preference.addEventListener("change",syncPreference);
    let visible=true;
    const syncVisibility=()=>{node.dataset.paused=String(!visible||document.hidden);};
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;syncVisibility();});
    observer.observe(node);syncVisibility();
    document.addEventListener("visibilitychange",syncVisibility);
    return()=>{observer.disconnect();preference.removeEventListener("change",syncPreference);document.removeEventListener("visibilitychange",syncVisibility);if(frame.current!==null)cancelAnimationFrame(frame.current);};
  },[]);

  function tilt(event:PointerEvent<HTMLDivElement>){
    if(reducedMotion.current||event.pointerType!=="mouse")return;
    const bounds=event.currentTarget.getBoundingClientRect();
    const x=Math.max(-1,Math.min(1,(event.clientX-bounds.left)/bounds.width*2-1));
    const y=Math.max(-1,Math.min(1,(event.clientY-bounds.top)/bounds.height*2-1));
    if(frame.current!==null)cancelAnimationFrame(frame.current);
    frame.current=requestAnimationFrame(()=>{
      scene.current?.style.setProperty("--tilt-x",`${-y*5}deg`);
      scene.current?.style.setProperty("--tilt-y",`${x*7}deg`);
      frame.current=null;
    });
  }

  return <div ref={scene} className={`hero-art ${styles.scene}`} role="img" aria-label="Three floating children's ride-on toy cars" onPointerMove={tilt} onPointerLeave={reset} onPointerCancel={reset}>
    <div className={styles.stage} aria-hidden="true">
      <div className={`hero-teddy tone-blue ${styles.card} ${styles.teddy}`}><span className="hero-tag">New this week</span><span className={`hero-teddy-emoji ${styles.toy}`}>🧸</span></div>
      <div className={`hero-bottle tone-gold ${styles.card} ${styles.bottle}`}><span className={styles.toy}>🍼</span></div>
      <div className={`hero-baby tone-rose ${styles.card} ${styles.baby}`}><span className={styles.toy}>👶</span></div>
      <span className={`${styles.sparkle} ${styles.sparkleOne}`}>✦</span>
      <span className={`${styles.sparkle} ${styles.sparkleTwo}`}>✧</span>
      <span className={`${styles.sparkle} ${styles.sparkleThree}`}>✦</span>
    </div>
  </div>;
}
