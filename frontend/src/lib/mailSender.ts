// Mail senders reuse the shared agent-name formatter: a clean alias ("mayor")
// passes through, a worktree path ("/home/ds/gascity-packs/gascity-packs-
// polecat-1") becomes "rig · agent" ("gascity-packs · polecat-1").
export { formatAgentName as formatMailSender } from './agentName';
