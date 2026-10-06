import { describe, expect, test } from 'claude-code/testing'

import { miniRobot, robot, ROBOT_WIDTH } from '../hooks/lib/robot'

const STATUSES = ['running', 'pending', 'waiting', 'idle', 'completed', 'failed', 'killed', 'unknown']

describe('robot', () => {
  test('every row is the same width, in every status and frame', () => {
    for (const status of STATUSES) {
      for (const frame of [0, 1, 2, 3]) {
        for (const row of robot('Explore', status, frame).rows) expect([...row].length).toBe(ROBOT_WIDTH)
      }
    }
  })

  test('the face follows the status', () => {
    expect(robot('main', 'running', 0).rows[2]).toContain('● ●')
    expect(robot('main', 'idle').rows[2]).toContain('– –')
    expect(robot('main', 'completed').rows[2]).toBe('▝▘▐ ^ ^ ▌▝▘')
    expect(robot('main', 'failed').rows[2]).toContain('× ×')
  })

  test('a working robot blinks and lights its antenna', () => {
    expect(robot('main', 'running', 0).rows[0]).toContain('✦')
    expect(robot('main', 'running', 1).rows[0]).toContain('╻')
    expect(robot('main', 'running', 3).rows[2]).toContain('▁ ▁')
  })

  test('the color follows the type, and red on failure', () => {
    expect(robot('main', 'running').color).toBe('claude')
    expect(robot('Explore', 'running').color).toBe('cyan')
    expect(robot('Plan', 'idle').color).toBe('magenta')
    expect(robot('my-custom-agent', 'running').color).toBe('green')
    expect(robot('Explore', 'failed').color).toBe('red')
    expect(robot('Explore', 'idle').isDim).toBe(true)
  })

  test('the mini robot fits one line', () => {
    expect(miniRobot('main', 'running').rows).toEqual(['▐●●▌'])
    expect(miniRobot('main', 'completed').rows).toEqual(['▐^^▌'])
  })
})
