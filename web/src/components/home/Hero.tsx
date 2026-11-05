"use client";

import Link from "next/link";
import { Ticket } from "../Ticket";
import { useAccountCheck } from "./useAccountCheck";

const HEADLINE = "text-[10vw] sm:text-[9vw] font-black lowercase tracking-tighter leading-[0.88] select-none";

// Two flat fields meeting at a hard edge, with the headline split across them.
export function Hero() {
  const { live, status, error, inputRef, submit } = useAccountCheck();

  return (
    <section id="check" className="w-full flex flex-col m-0 p-0 border-b-2 border-night">
      <div className="w-full bg-yellow pt-16 pb-0 px-6 sm:px-12 flex flex-col justify-end items-center text-center">
        <h1 className={`${HEADLINE} text-night`}>
          <span className="sr-only">vouch: </span>put money<span className="sr-only"> behind it.</span>
        </h1>
      </div>
      <div className="w-full h-0 border-b-2 border-night" />
      <div className="w-full bg-night pt-0 pb-16 px-6 sm:px-12 flex flex-col justify-start items-center text-center">
        <p aria-hidden="true" className={`${HEADLINE} text-yellow mb-10`}>behind it.</p>
        <p className="max-w-3xl text-lg sm:text-2xl text-paper font-medium lowercase leading-relaxed mb-10">
          Vouch is a counterparty check for AI agents that pay. Every answer has a bond on it, and whoever proves it wrong takes the bond.
        </p>
        <form className="w-full max-w-xl flex flex-col sm:flex-row border-2 border-paper mb-6" onSubmit={submit}>
          <label htmlFor="account" className="sr-only">NEAR account to check</label>
          <input
            ref={inputRef}
            id="account"
            name="account"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="wrap.near…"
            aria-describedby="check-error"
            aria-invalid={status === "error"}
            className="min-w-0 flex-1 bg-white text-night font-bold lowercase px-6 py-4 border-none placeholder:text-[#444748] text-base focus:outline-none"
          />
          <button type="submit" disabled={status === "loading"} className="bg-yellow text-night font-bold lowercase px-6 py-4 hover:bg-white hover:text-night border-t-2 sm:border-t-0 sm:border-l-2 border-night disabled:cursor-wait">
            {status === "loading" ? "checking…" : "check an account"}
          </button>
        </form>
        {status === "error" && <p id="check-error" role="status" className="mb-6 text-paper lowercase">{error}</p>}
        {live && (
          <div key={live.account + live.note} className="w-full max-w-xl mb-6 animate-[print_0.6s_var(--ease-out)] text-left">
            <Ticket data={live} />
          </div>
        )}
        <Link href="/attack" className="text-[1.125rem] font-bold tracking-[-0.02em] text-sky underline lowercase hover:text-white">
          watch it stop a real attack
        </Link>
      </div>
    </section>
  );
}
