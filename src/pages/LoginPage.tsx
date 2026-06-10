import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, BarChart3, Brain, Fingerprint, Network, ShieldCheck, Zap } from "lucide-react";
import { ROLES } from "@/lib/constants";
import { useAppStore } from "@/store/useAppStore";
import type { RoleId } from "@/lib/types";

const HIGHLIGHTS = [
  { icon: Brain, text: "12-agent AI pipeline — domain detection to executive storytelling" },
  { icon: BarChart3, text: "Dashboards generated automatically in under 60 seconds" },
  { icon: Network, text: "Congestion, saturation and root-cause intelligence built-in" },
  { icon: ShieldCheck, text: "Runs entirely inside your OSS environment — air-gap friendly" },
];

export function LoginPage() {
  const login = useAppStore((s) => s.login);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [role, setRole] = useState<RoleId>("cto");

  const submit = () => {
    login(name.trim() || "Network Engineer", role);
    navigate("/");
  };

  return (
    <div className="dark flex min-h-screen bg-[#020617] text-slate-100">
      {/* ----------------------------- left brand ----------------------------- */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden p-12 lg:flex">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(800px 500px at 20% 10%, rgba(59,130,246,.16), transparent 60%), radial-gradient(700px 500px at 80% 90%, rgba(6,182,212,.12), transparent 55%)",
          }}
        />
        {/* network grid decoration */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.13]" aria-hidden>
          <defs>
            <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
              <path d="M 44 0 L 0 0 0 44" fill="none" stroke="#3b82f6" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-navy-800 shadow-glow">
              <Activity size={22} className="text-accent-400" />
            </div>
            <div>
              <div className="text-xl font-extrabold tracking-tight">NetPulse</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Network Intelligence Hub</div>
            </div>
          </div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6 }}
            className="mt-16 max-w-md text-[34px] font-extrabold leading-[1.15] tracking-tight"
          >
            Any network dataset.
            <br />
            <span className="bg-gradient-to-r from-accent-400 to-info-500 bg-clip-text text-transparent">
              Executive intelligence
            </span>{" "}
            in 60 seconds.
          </motion.h1>

          <div className="mt-10 space-y-4">
            {HIGHLIGHTS.map((h, i) => (
              <motion.div
                key={h.text}
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.1 }}
                className="flex items-center gap-3 text-[13.5px] text-slate-300"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500/12 text-accent-400">
                  <h.icon size={15} />
                </div>
                {h.text}
              </motion.div>
            ))}
          </div>
        </div>

        <p className="relative text-[11px] text-slate-500">
          Built for OSS · NOC · Capacity Planning · Performance · Service Assurance · CTO Office
        </p>
      </div>

      {/* ----------------------------- right form ----------------------------- */}
      <div className="flex flex-1 items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
          <p className="mt-1 text-[13px] text-slate-400">
            Enterprise SSO simulated locally — select your role to shape the workspace.
          </p>

          <label className="mt-7 block text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. Ahmed Salah"
            className="mt-2 w-full rounded-xl border border-navy-700 bg-navy-900 px-4 py-2.5 text-[14px] text-slate-100 placeholder:text-slate-500 focus:border-accent-500 focus:outline-none"
          />

          <label className="mt-5 block text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Role</label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRole(r.id)}
                className={`rounded-xl border p-3 text-left transition-all ${
                  role === r.id
                    ? "border-accent-500 bg-accent-500/10 shadow-glow"
                    : "border-navy-700 bg-navy-900/60 hover:border-navy-700 hover:bg-navy-900"
                }`}
              >
                <div className={`text-[12.5px] font-bold ${role === r.id ? "text-accent-400" : "text-slate-200"}`}>{r.label}</div>
                <div className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{r.description}</div>
              </button>
            ))}
          </div>

          <button
            onClick={submit}
            className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 py-3 text-[14px] font-bold text-white shadow-glow transition-all hover:bg-accent-400"
          >
            <Fingerprint size={17} />
            Continue with SSO
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[10.5px] text-slate-500">
            <Zap size={11} className="text-accent-400" />
            Demo authentication — production deployments integrate AD / LDAP / SAML
          </p>
        </motion.div>
      </div>
    </div>
  );
}
