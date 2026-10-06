// Block-character robots, one per agent: the face follows the agent's status,
// the color its type. Every glyph is a single terminal cell wide.

export type Robot = {
  rows: string[]
  color: string
  isDim: boolean
}

// Width of the full robot: the head is 7 cells, plus 2 on each side for the
// arms a finished robot raises.
export const ROBOT_WIDTH = 11

const TYPE_COLORS: Record<string, string> = {
  main: 'claude',
  Explore: 'cyan',
  Plan: 'magenta',
  'general-purpose': 'yellow',
  teammate: 'blue',
}

type Face = { eyes: string; antenna: string; isCheering?: boolean }

// `frame` ticks while an agent works: the antenna lights up and the eyes blink.
function face(status: string, frame: number): Face {
  switch (status) {
    case 'running':
      return frame % 4 === 3 ? { eyes: '▁ ▁', antenna: '╻' } : { eyes: '● ●', antenna: frame % 2 === 0 ? '✦' : '╻' }
    case 'pending':
      return { eyes: '◦ ◦', antenna: '╻' }
    case 'waiting':
      return { eyes: '● ●', antenna: '?' }
    case 'completed':
      return { eyes: '^ ^', antenna: '╻', isCheering: true }
    case 'failed':
    case 'killed':
      return { eyes: '× ×', antenna: '╷' }
    default:
      return { eyes: '– –', antenna: '╷' }
  }
}

export function robotColor(type: string, status: string): string {
  if (status === 'failed' || status === 'killed') return 'red'
  return TYPE_COLORS[type] ?? 'green'
}

export function robot(type: string, status: string, frame = 0): Robot {
  const f = face(status, frame)
  const arm = f.isCheering ? '▝▘' : '  '
  return {
    rows: [
      `     ${f.antenna}     `,
      '  ▗▄▄█▄▄▖  ',
      `${arm}▐ ${f.eyes} ▌${arm}`,
      '  ▝▀▙▄▟▀▘  ',
    ],
    color: robotColor(type, status),
    isDim: status === 'idle' || status === 'completed',
  }
}

// The one-line robot, for rows where the conversation takes the room below.
export function miniRobot(type: string, status: string, frame = 0): Robot {
  const eyes = face(status, frame).eyes.replace(' ', '')
  return { rows: [`▐${eyes}▌`], color: robotColor(type, status), isDim: status === 'idle' || status === 'completed' }
}
