"""Game world: levels, physics and rules. No drawing and no window in here,
so everything can be tested automatically."""

from dataclasses import dataclass, field

TILE = 40
ROWS = 14

# Physics (pixels and seconds)
GRAVITY = 2200.0
MAX_FALL_SPEED = 900.0
MOVE_SPEED = 260.0
JUMP_SPEED = 760.0
JUMP_CUT = 0.45            # releasing jump early cuts the rise to this fraction
COYOTE_TIME = 0.10         # can still jump this long after walking off a ledge
JUMP_BUFFER = 0.10         # a jump pressed slightly before landing still counts
ENEMY_SPEED = 70.0
INVULNERABLE_TIME = 1.5
KNOCKBACK_SPEED = 220.0
KNOCKBACK_TIME = 0.25
START_LIVES = 3

# Scoring
COIN_POINTS = 10
ENEMY_POINTS = 100
LEVEL_POINTS = 200
ALL_COINS_BONUS = 300

PLAYER_W, PLAYER_H = 28, 38
ENEMY_W, ENEMY_H = 30, 26


class LevelError(Exception):
    """The level map is not valid."""


@dataclass
class Player:
    x: float
    y: float
    vx: float = 0.0
    vy: float = 0.0
    on_ground: bool = False
    facing: int = 1
    coyote: float = 0.0
    jump_buffer: float = 0.0
    invulnerable: float = 0.0
    knock_vx: float = 0.0
    knock_time: float = 0.0


@dataclass
class Enemy:
    x: float
    y: float
    direction: int = -1
    vy: float = 0.0
    alive: bool = True


@dataclass
class Coin:
    col: int
    row: int
    collected: bool = False


@dataclass
class World:
    rows: list
    lives: int = START_LIVES
    score: int = 0
    solids: set = field(default_factory=set)
    coins: list = field(default_factory=list)
    spikes: list = field(default_factory=list)
    enemies: list = field(default_factory=list)
    start: tuple = (0, 0)
    flag: tuple = (0, 0)
    width_tiles: int = 0
    player: Player = None
    checkpoint: tuple = (0.0, 0.0)
    checkpoint_timer: float = 0.0
    status: str = "playing"          # playing, complete, game_over
    time: float = 0.0
    events: list = field(default_factory=list)   # 'jump', 'coin', 'stomp', 'hurt', 'complete'
    level_bonus: int = 0

    def __post_init__(self):
        self.parse(self.rows)
        self.player = self.spawn_player()
        self.checkpoint = (self.player.x, self.player.y)

    # ---------- Loading ----------

    def parse(self, rows):
        if len(rows) != ROWS:
            raise LevelError(f"A level needs exactly {ROWS} rows, this one has {len(rows)}.")
        width = len(rows[0])
        if any(len(row) != width for row in rows):
            raise LevelError("All rows of a level must have the same length.")
        starts, flags = [], []
        for r, row in enumerate(rows):
            for c, char in enumerate(row):
                if char == "#":
                    self.solids.add((c, r))
                elif char == "o":
                    self.coins.append(Coin(c, r))
                elif char == "^":
                    self.spikes.append((c, r))
                elif char == "E":
                    self.enemies.append(Enemy(c * TILE + (TILE - ENEMY_W) / 2, (r + 1) * TILE - ENEMY_H))
                elif char == "P":
                    starts.append((c, r))
                elif char == "F":
                    flags.append((c, r))
                elif char != ".":
                    raise LevelError(f"Unknown symbol '{char}' at row {r + 1}, column {c + 1}.")
        if len(starts) != 1:
            raise LevelError("A level needs exactly one 'P' (player start).")
        if len(flags) != 1:
            raise LevelError("A level needs exactly one 'F' (goal flag).")
        self.start, self.flag = starts[0], flags[0]
        self.width_tiles = width

    def spawn_player(self):
        col, row = self.start
        return Player(col * TILE + (TILE - PLAYER_W) / 2, (row + 1) * TILE - PLAYER_H)

    @property
    def width_px(self):
        return self.width_tiles * TILE

    @property
    def height_px(self):
        return ROWS * TILE

    @property
    def total_coins(self):
        return len(self.coins)

    @property
    def coins_collected(self):
        return sum(1 for coin in self.coins if coin.collected)

    # ---------- Geometry helpers ----------

    def solid_at(self, col, row):
        return (col, row) in self.solids

    def overlaps_solid(self, left, top, width, height):
        """Which solid tiles overlap this box? Returns a list of (col, row)."""
        found = []
        c0, c1 = int(left // TILE), int((left + width - 1e-6) // TILE)
        r0, r1 = int(top // TILE), int((top + height - 1e-6) // TILE)
        for c in range(c0, c1 + 1):
            for r in range(r0, r1 + 1):
                if (c, r) in self.solids:
                    found.append((c, r))
        return found

    def player_box(self):
        p = self.player
        return (p.x, p.y, PLAYER_W, PLAYER_H)

    @staticmethod
    def boxes_touch(a, b):
        ax, ay, aw, ah = a
        bx, by, bw, bh = b
        return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah

    def spike_box(self, spike):
        col, row = spike
        return (col * TILE + 6, row * TILE + TILE * 0.55, TILE - 12, TILE * 0.45)

    def coin_box(self, coin):
        return (coin.col * TILE + 9, coin.row * TILE + 9, TILE - 18, TILE - 18)

    def flag_box(self):
        """A tall pole, so you cannot jump over the goal by accident."""
        col, row = self.flag
        return (col * TILE + 8, (row - 4) * TILE, TILE - 16, TILE * 5)

    def enemy_box(self, enemy):
        return (enemy.x, enemy.y, ENEMY_W, ENEMY_H)

    # ---------- Main update ----------

    def update(self, dt, move=0, jump_pressed=False, jump_held=False):
        """Advance the game by dt seconds.

        move: -1 (left), 0, or 1 (right). jump_pressed: the jump key went down this frame.
        jump_held: the jump key is still down.
        """
        self.events = []
        if self.status != "playing":
            return
        self.time += dt
        p = self.player
        p.invulnerable = max(0.0, p.invulnerable - dt)

        # --- jumping (with coyote time and jump buffering) ---
        p.coyote = COYOTE_TIME if p.on_ground else p.coyote - dt
        p.jump_buffer = JUMP_BUFFER if jump_pressed else p.jump_buffer - dt
        if p.jump_buffer > 0 and p.coyote > 0:
            p.vy = -JUMP_SPEED
            p.coyote = 0.0
            p.jump_buffer = 0.0
            p.on_ground = False
            self.events.append("jump")
        if not jump_held and p.vy < -JUMP_SPEED * JUMP_CUT:
            p.vy = -JUMP_SPEED * JUMP_CUT

        # --- movement ---
        p.knock_time = max(0.0, p.knock_time - dt)
        if p.knock_time > 0:
            p.vx = p.knock_vx                  # after a hit you are pushed away for a moment
        else:
            p.vx = move * MOVE_SPEED
            if move:
                p.facing = move
        p.vy = min(p.vy + GRAVITY * dt, MAX_FALL_SPEED)
        previous_bottom = p.y + PLAYER_H
        self.move_player(dt)

        # --- enemies, pickups, hazards ---
        for enemy in self.enemies:
            if enemy.alive:
                self.move_enemy(enemy, dt)
        self.check_coins()
        self.check_enemies(previous_bottom)
        self.check_spikes()
        self.update_checkpoint(dt)
        if p.y > self.height_px + 3 * TILE:
            self.hurt(fell=True)
        if self.status == "playing" and self.boxes_touch(self.player_box(), self.flag_box()):
            self.complete_level()

    # ---------- Player physics ----------

    def move_player(self, dt):
        p = self.player

        p.x += p.vx * dt
        p.x = max(0.0, min(p.x, self.width_px - PLAYER_W))
        for col, row in self.overlaps_solid(*self.player_box()):
            if p.vx > 0:
                p.x = col * TILE - PLAYER_W
            elif p.vx < 0:
                p.x = (col + 1) * TILE

        p.y += p.vy * dt
        p.on_ground = False
        for col, row in self.overlaps_solid(*self.player_box()):
            if p.vy > 0:
                p.y = row * TILE - PLAYER_H
                p.on_ground = True
            elif p.vy < 0:
                p.y = (row + 1) * TILE
            p.vy = 0.0

    # ---------- Enemies ----------

    def ground_ahead(self, enemy):
        """Is there floor just in front of the enemy's leading foot?"""
        probe_x = enemy.x + (ENEMY_W + 2 if enemy.direction > 0 else -2)
        probe_y = enemy.y + ENEMY_H + 2
        return self.solid_at(int(probe_x // TILE), int(probe_y // TILE))

    def move_enemy(self, enemy, dt):
        enemy.x += enemy.direction * ENEMY_SPEED * dt
        for col, row in self.overlaps_solid(enemy.x, enemy.y, ENEMY_W, ENEMY_H):
            enemy.x = col * TILE - ENEMY_W if enemy.direction > 0 else (col + 1) * TILE
            enemy.direction *= -1
            break
        else:
            if not self.ground_ahead(enemy):
                enemy.direction *= -1

        enemy.vy = min(enemy.vy + GRAVITY * dt, MAX_FALL_SPEED)
        enemy.y += enemy.vy * dt
        for col, row in self.overlaps_solid(enemy.x, enemy.y, ENEMY_W, ENEMY_H):
            if enemy.vy > 0:
                enemy.y = row * TILE - ENEMY_H
            enemy.vy = 0.0

    # ---------- Pickups and hazards ----------

    def check_coins(self):
        box = self.player_box()
        for coin in self.coins:
            if not coin.collected and self.boxes_touch(box, self.coin_box(coin)):
                coin.collected = True
                self.score += COIN_POINTS
                self.events.append("coin")

    def check_enemies(self, previous_bottom):
        p = self.player
        for enemy in self.enemies:
            if not enemy.alive or not self.boxes_touch(self.player_box(), self.enemy_box(enemy)):
                continue
            landed_on_top = p.vy > 0 and previous_bottom <= enemy.y + 14
            if landed_on_top:
                enemy.alive = False
                p.vy = -JUMP_SPEED * 0.6
                p.on_ground = False
                self.score += ENEMY_POINTS
                self.events.append("stomp")
            elif p.invulnerable <= 0:
                self.hurt(source_x=enemy.x + ENEMY_W / 2)

    def check_spikes(self):
        if self.player.invulnerable > 0:
            return
        box = (self.player.x + 4, self.player.y + 4, PLAYER_W - 8, PLAYER_H - 4)
        for spike in self.spikes:
            if self.boxes_touch(box, self.spike_box(spike)):
                self.hurt(source_x=spike[0] * TILE + TILE / 2)
                return

    def update_checkpoint(self, dt):
        """Remember a safe place to stand, so a fall sends you back there."""
        p = self.player
        self.checkpoint_timer -= dt
        if not p.on_ground or self.checkpoint_timer > 0:
            return
        near_spike = any(abs(c * TILE + TILE / 2 - p.x) < 3 * TILE and abs(r * TILE - p.y) < 3 * TILE
                         for c, r in self.spikes)
        near_enemy = any(e.alive and abs(e.x - p.x) < 3 * TILE and abs(e.y - p.y) < 2 * TILE
                         for e in self.enemies)
        if not near_spike and not near_enemy:
            self.checkpoint = (p.x, p.y)
            self.checkpoint_timer = 0.5

    def hurt(self, source_x=None, fell=False):
        p = self.player
        if p.invulnerable > 0 and not fell:
            return
        self.lives -= 1
        self.events.append("hurt")
        if self.lives <= 0:
            self.status = "game_over"
            return
        p.invulnerable = INVULNERABLE_TIME
        if fell:
            p.x, p.y = self.checkpoint
            p.vx = p.vy = 0.0
            p.knock_time = 0.0
        else:
            p.vy = -JUMP_SPEED * 0.55
            p.on_ground = False
            away = -1 if (source_x is not None and source_x > p.x + PLAYER_W / 2) else 1
            p.knock_vx = away * KNOCKBACK_SPEED
            p.knock_time = KNOCKBACK_TIME

    def complete_level(self):
        self.level_bonus = LEVEL_POINTS
        if self.total_coins > 0 and self.coins_collected == self.total_coins:
            self.level_bonus += ALL_COINS_BONUS
        self.score += self.level_bonus
        self.lives = min(START_LIVES, self.lives + 1)
        self.status = "complete"
        self.events.append("complete")
