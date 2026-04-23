"""
Training Module for Stalker AI
Implements training loop for PPO networks using simulated player AI.
"""

import numpy as np
import random
import math
import torch
import torch.nn as nn
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, field
from collections import deque
import time
import json

from stalker_ai import (
    SwarmManager,
    StalkerConfig,
    DifficultyMode,
    StalkerState,
    ZONES,
)


# ── Training Configuration ────────────────────────────────────────────────────────

@dataclass
class TrainingConfig:
    # Training parameters
    NUM_EPISODES: int = 1000
    MAX_STEPS_PER_EPISODE: int = 1000
    SAVE_INTERVAL: int = 100
    
    # PPO training
    BATCH_SIZE: int = 64
    GAMMA: float = 0.99
    GAE_LAMBDA: float = 0.95
    CLIP_EPSILON: float = 0.2
    LEARNING_RATE: float = 0.0003
    UPDATE_EPOCHS: int = 10
    
    # Base reward shaping
    REWARD_CATCH: float = 100.0
    REWARD_CLOSE_PROXIMITY: float = 10.0
    REWARD_PREDICTION_ACCURACY: float = 5.0
    REWARD_COORDINATION: float = 15.0
    PENALTY_IDLE: float = -0.1
    PENALTY_SEPARATION: float = -2.0
    
    # Role-specific rewards (Elite Trio)
    # Architect rewards
    ARCHITECT_REWARD_PREDICTED_ZONE_TIME: float = 20.0
    ARCHITECT_REWARD_EXIT_DISTANCE: float = 15.0
    ARCHITECT_REWARD_HERDING: float = 25.0
    
    # Hound rewards
    HOUND_REWARD_PROXIMITY: float = 15.0
    HOUND_REWARD_STAMINA_DRAIN: float = 10.0
    HOUND_REWARD_PRESSURE: float = 12.0
    
    # Ghost rewards
    GHOST_REWARD_STEALTH_CATCH: float = 150.0  # Massive bonus
    GHOST_REWARD_UNDETECTED_TIME: float = 5.0
    GHOST_REWARD_AMBUSH: float = 30.0
    
    # Player AI difficulty
    PLAYER_SKILL_LEVEL: float = 0.5  # 0.0 = random, 1.0 = optimal
    PLAYER_KEYS_TO_COLLECT: int = 5
    PLAYER_STAMINA_MAX: float = 100.0
    
    # Evaluation
    EVAL_INTERVAL: int = 50
    EVAL_EPISODES: int = 10


# ── Simulated Player AI ─────────────────────────────────────────────────────────

@dataclass
class PlayerState:
    x: float
    y: float
    keys_collected: int = 0
    hide: bool = False
    moved: bool = False
    last_move_tick: int = 0
    path_history: List[Tuple[float, float]] = field(default_factory=list)
    stamina: float = 100.0  # Player stamina for Hound pressure
    current_zone: int = 0  # Track which zone player is in


class PlayerAI:
    """Simulated player AI for training stalkers."""
    
    def __init__(self, config: TrainingConfig, map_bounds: Tuple[int, int, int, int]):
        self.config = config
        self.min_x, self.max_x, self.min_y, self.max_y = map_bounds
        self.key_locations = self._generate_key_locations()
        
    def _generate_key_locations(self) -> List[Tuple[int, int]]:
        """Generate key locations across the map."""
        locations = []
        # Distribute keys across different zones
        for zone_id in [0, 10, 14, 19, 28]:
            zone = ZONES.get(zone_id)
            if zone:
                # Add some randomness around zone center
                for _ in range(2):
                    offset_x = random.randint(-2, 2)
                    offset_y = random.randint(-2, 2)
                    locations.append((zone.x + offset_x, zone.y + offset_y))
        return locations[:self.config.PLAYER_KEYS_TO_COLLECT]
    
    def reset(self) -> PlayerState:
        """Reset player to starting position."""
        start_zone = ZONES[0]  # Entrance Hall
        return PlayerState(
            x=float(start_zone.x),
            y=float(start_zone.y),
            stamina=self.config.PLAYER_STAMINA_MAX,
            current_zone=0,
            path_history=[(start_zone.x, start_zone.y)]
        )
    
    def get_action(
        self, 
        player: PlayerState, 
        stalker_positions: List[Tuple[float, float]],
        tile_at_func,
        tick: int
    ) -> Tuple[int, int]:
        """Get player movement action based on skill level."""
        # Mix of optimal and random behavior based on skill level
        if random.random() < self.config.PLAYER_SKILL_LEVEL:
            return self._optimal_action(player, stalker_positions, tile_at_func)
        else:
            return self._random_action(player, tile_at_func)
    
    def _optimal_action(
        self, 
        player: PlayerState, 
        stalker_positions: List[Tuple[float, float]],
        tile_at_func
    ) -> Tuple[int, int]:
        """Calculate optimal movement to avoid stalkers and collect keys."""
        # Find nearest key
        if player.keys_collected < len(self.key_locations):
            target = self.key_locations[player.keys_collected]
        else:
            # Head to exit (Zone 28)
            target = (ZONES[28].x, ZONES[28].y)
        
        # Calculate direction to target
        dx = target[0] - player.x
        dy = target[1] - player.y
        
        # Avoid stalkers
        avoidance_x, avoidance_y = 0, 0
        for sx, sy in stalker_positions:
            dist = math.sqrt((sx - player.x)**2 + (sy - player.y)**2)
            if dist < 5:  # Too close
                avoidance_x -= (sx - player.x) / (dist + 0.1)
                avoidance_y -= (sy - player.y) / (dist + 0.1)
        
        # Combine target seeking and avoidance
        move_x = dx + avoidance_x * 3
        move_y = dy + avoidance_y * 3
        
        # Normalize to discrete action
        if abs(move_x) > abs(move_y):
            return (1 if move_x > 0 else -1, 0)
        else:
            return (0, 1 if move_y > 0 else -1)
    
    def _random_action(self, player: PlayerState, tile_at_func) -> Tuple[int, int]:
        """Random movement action."""
        actions = [(0, 1), (0, -1), (1, 0), (-1, 0), (0, 0)]
        return random.choice(actions)
    
    def update(self, player: PlayerState, action: Tuple[int, int], tile_at_func) -> PlayerState:
        """Update player state after action."""
        new_x = player.x + action[0]
        new_y = player.y + action[1]
        
        # Drain stamina on movement (for Hound pressure)
        if action != (0, 0):
            player.stamina = max(0, player.stamina - 0.5)
        
        # Check bounds and walkability
        walkable_tiles = [0, 2, 5, 6, 10, 12, 15, 17, 20, 24]
        if (self.min_x <= new_x <= self.max_x and 
            self.min_y <= new_y <= self.max_y):
            tile = tile_at_func(int(round(new_x)), int(round(new_y)))
            if tile in walkable_tiles:
                player.x = new_x
                player.y = new_y
                player.moved = True
                player.last_move_tick += 1
            else:
                player.moved = False
        else:
            player.moved = False
        
        # Check key collection
        for i, (kx, ky) in enumerate(self.key_locations):
            if i >= player.keys_collected:
                dist = math.sqrt((player.x - kx)**2 + (player.y - ky)**2)
                if dist < 1.0:
                    player.keys_collected += 1
                    break
        
        # Update current zone (simplified distance check)
        for zone_id, zone in ZONES.items():
            dist = math.sqrt((player.x - zone.x)**2 + (player.y - zone.y)**2)
            if dist < 3:
                player.current_zone = zone_id
                break
        
        player.path_history.append((player.x, player.y))
        return player


# ── Training Environment ─────────────────────────────────────────────────────────

class TrainingEnvironment:
    """Simulated environment for training stalker AI."""
    
    def __init__(self, config: TrainingConfig, stalker_config: StalkerConfig):
        self.training_config = config
        self.stalker_config = stalker_config
        self.player_ai = PlayerAI(config, (0, 27, 0, 9))
        self.swarm = None
        self.player = None
        self.tick = 0
        
    def reset(self, difficulty: DifficultyMode = DifficultyMode.NORMAL) -> Dict:
        """Reset environment for new episode."""
        self.swarm = SwarmManager(self.stalker_config, difficulty)
        self.swarm.spawn_swarm()
        self.player = self.player_ai.reset()
        self.tick = 0
        
        return self._get_observation()
    
    def _get_observation(self) -> Dict:
        """Get current observation."""
        return {
            'player': {
                'x': self.player.x,
                'y': self.player.y,
                'keys': self.player.keys_collected,
                'hide': self.player.hide,
                'moved': self.player.moved,
                'last_move_tick': self.player.last_move_tick
            },
            'stalkers': [
                {
                    'id': s.id,
                    'x': s.x,
                    'y': s.y,
                    'state': s.state.value,
                    'detection_confidence': s.detection_confidence
                }
                for s in self.swarm.stalkers
            ],
            'tick': self.tick
        }
    
    def step(self, action: Optional[Tuple[int, int]] = None) -> Tuple[Dict, float, bool, Dict]:
        """Execute one step in the environment."""
        # Player action
        if action is None:
            action = self.player_ai.get_action(
                self.player,
                [(s.x, s.y) for s in self.swarm.stalkers],
                self._mock_tile_at,
                self.tick
            )
        
        self.player = self.player_ai.update(self.player, action, self._mock_tile_at)
        
        # Update swarm
        result = self.swarm.update_swarm(
            self._get_player_dict(),
            self._mock_tile_at,
            self.tick,
            [1, 8, 14]  # Blocked tiles
        )
        
        # Update key count in swarm
        self.swarm.set_player_keys(self.player.keys_collected)
        
        self.tick += 1
        
        # Calculate reward
        reward = self._calculate_reward(result)
        
        # Check termination
        done = result.get('caught', False) or self.tick >= self.training_config.MAX_STEPS_PER_EPISODE
        
        info = {
            'caught': result.get('caught', False),
            'steps': self.tick,
            'keys_collected': self.player.keys_collected
        }
        
        return self._get_observation(), reward, done, info
    
    def _get_player_dict(self) -> Dict:
        """Get player as dict for swarm update."""
        return {
            'x': self.player.x,
            'y': self.player.y,
            'hide': self.player.hide,
            'moved': self.player.moved,
            'last_move_tick': self.player.last_move_tick
        }
    
    def _mock_tile_at(self, x: int, y: int) -> int:
        """Mock tile function for training."""
        # Simple mock: edges are walls, center is walkable
        if x <= 0 or x >= 27 or y <= 0 or y >= 9:
            return 1  # Wall
        if 10 <= x <= 15 and 3 <= y <= 5:
            return 8  # Obstacle
        return 0  # Floor
    
    def _calculate_reward(self, result: Dict) -> float:
        """Calculate reward for the swarm with role-specific shaping."""
        reward = 0.0
        
        # Base catch reward
        if result.get('caught', False):
            reward += self.training_config.REWARD_CATCH
            if result.get('stealth_catch', False):
                reward += self.training_config.GHOST_REWARD_STEALTH_CATCH
        else:
            # Calculate role-specific rewards
            for stalker in self.env.swarm.stalkers:
                stalker_reward = self._calculate_role_reward(stalker)
                reward += stalker_reward
            
            # Proximity reward (closer is better)
            min_dist = float('inf')
            for stalker in self.env.swarm.stalkers:
                dist = math.sqrt((stalker.x - self.player.x)**2 + (stalker.y - self.player.y)**2)
                min_dist = min(min_dist, dist)
            
            if min_dist < 3:
                reward += self.training_config.REWARD_CLOSE_PROXIMITY * (3 - min_dist) / 3
            else:
                reward += self.training_config.PENALTY_SEPARATION
            
            # Coordination reward (stalkers working together)
            positions = [(s.x, s.y) for s in self.env.swarm.stalkers]
            centroid_x = sum(p[0] for p in positions) / len(positions)
            centroid_y = sum(p[1] for p in positions) / len(positions)
            
            player_dist_to_centroid = math.sqrt(
                (self.player.x - centroid_x)**2 + (self.player.y - centroid_y)**2
            )
            if player_dist_to_centroid < 2:
                reward += self.training_config.REWARD_COORDINATION
            
            # Idle penalty
            for stalker in self.env.swarm.stalkers:
                if stalker.state == StalkerState.WAIT:
                    reward += self.training_config.PENALTY_IDLE
        
        return reward
    
    def _calculate_role_reward(self, stalker) -> float:
        """Calculate role-specific reward for a stalker."""
        from stalker_ai import AgentRole
        
        reward = 0.0
        
        if stalker.role == AgentRole.ARCHITECT:
            # Architect: Territory control & prediction
            # Reward for player being in predicted zone
            if stalker.belief_state.zone_activity:
                for zone_id, activity in stalker.belief_state.zone_activity.items():
                    if self.player.current_zone == zone_id:
                        reward += self.training_config.ARCHITECT_REWARD_PREDICTED_ZONE_TIME * activity
            
            # Reward for being near exit zones
            exit_zones = [28, 29]  # Research Chamber, The Void
            if self.player.current_zone in exit_zones:
                dist_to_exit = math.sqrt(
                    (self.player.x - ZONES[28].x)**2 + (self.player.y - ZONES[28].y)**2
                )
                reward += self.training_config.ARCHITECT_REWARD_EXIT_DISTANCE / (dist_to_exit + 1)
            
            # Reward for herding (player moving toward predicted position)
            if stalker.target_x is not None:
                predicted_dist = math.sqrt(
                    (self.player.x - stalker.target_x)**2 + 
                    (self.player.y - stalker.target_y)**2
                )
                if predicted_dist < 5:
                    reward += self.training_config.ARCHITECT_REWARD_HERDING
        
        elif stalker.role == AgentRole.HOUND:
            # Hound: Pressure & stamina drain
            dist = math.sqrt((stalker.x - self.player.x)**2 + (stalker.y - self.player.y)**2)
            
            # Proximity reward
            if dist < 5:
                reward += self.training_config.HOUND_REWARD_PROXIMITY * (5 - dist) / 5
            
            # Stamina drain reward
            stamina_drained = self.training_config.PLAYER_STAMINA_MAX - self.player.stamina
            reward += self.training_config.HOUND_REWARD_STAMINA_DRAIN * (stamina_drained / 100.0)
            
            # Pressure reward (player moving erratically)
            if len(self.player.path_history) > 10:
                recent_moves = self.player.path_history[-10:]
                direction_changes = 0
                for i in range(1, len(recent_moves)):
                    dx1 = recent_moves[i][0] - recent_moves[i-1][0]
                    dy1 = recent_moves[i][1] - recent_moves[i-1][1]
                    dx2 = recent_moves[i-1][0] - recent_moves[i-2][0] if i > 1 else 0
                    dy2 = recent_moves[i-1][1] - recent_moves[i-2][1] if i > 1 else 0
                    if dx1 * dx2 + dy1 * dy2 < 0:  # Direction change
                        direction_changes += 1
                if direction_changes > 3:
                    reward += self.training_config.HOUND_REWARD_PRESSURE
        
        elif stalker.role == AgentRole.GHOST:
            # Ghost: Stealth & ambush
            # Undetected time reward
            if stalker.stealth_ticks > 0:
                reward += self.training_config.GHOST_REWARD_UNDETECTED_TIME * (stalker.stealth_ticks / 100.0)
            
            # Ambush reward (positioned between player and exit)
            if self.player.current_zone in [18, 19]:  # Nursery, Ballroom
                dist = math.sqrt((stalker.x - self.player.x)**2 + (stalker.y - self.player.y)**2)
                if 3 < dist < 8:  # Optimal ambush distance
                    reward += self.training_config.GHOST_REWARD_AMBUSH
        
        return reward

class PPOTrainer:
    """Trains PPO networks for the stalker swarm."""
    
    def __init__(self, config: TrainingConfig, stalker_config: StalkerConfig):
        self.training_config = config
        self.stalker_config = stalker_config
        self.env = TrainingEnvironment(config, stalker_config)
        
        # Training metrics
        self.episode_rewards = []
        self.episode_lengths = []
        self.catch_rates = []
        
    def train(self, difficulty: DifficultyMode = DifficultyMode.NORMAL):
        """Main training loop."""
        print(f"Starting training for difficulty: {difficulty.value}")
        print(f"Episodes: {self.training_config.NUM_EPISODES}")
        
        for episode in range(self.training_config.NUM_EPISODES):
            obs = self.env.reset(difficulty)
            episode_reward = 0
            trajectory = []
            
            for step in range(self.training_config.MAX_STEPS_PER_EPISODE):
                # Collect actions from all stalkers
                actions = []
                for stalker in self.env.swarm.stalkers:
                    state = {
                        'target_dx': self.env.player.x - stalker.x,
                        'target_dy': self.env.player.y - stalker.y,
                        'obstacle_ahead': False
                    }
                    action = stalker.ppo_network.select_action(state)
                    actions.append(action)
                
                # Step environment
                next_obs, reward, done, info = self.env.step()
                episode_reward += reward
                
                # Store trajectory
                trajectory.append({
                    'actions': actions,
                    'reward': reward,
                    'states': [s for s in self.env.swarm.stalkers]
                })
                
                if done:
                    break
            
            # Update PPO networks
            self._update_networks(trajectory)
            
            # Log metrics
            self.episode_rewards.append(episode_reward)
            self.episode_lengths.append(self.env.tick)
            self.catch_rates.append(1 if info.get('caught', False) else 0)
            
            # Print progress
            if episode % 10 == 0:
                avg_reward = np.mean(self.episode_rewards[-10:])
                avg_length = np.mean(self.episode_lengths[-10:])
                catch_rate = np.mean(self.catch_rates[-10:])
                print(f"Episode {episode}: Avg Reward={avg_reward:.2f}, "
                      f"Avg Length={avg_length:.1f}, Catch Rate={catch_rate:.2%}")
            
            # Save checkpoint
            if episode % self.training_config.SAVE_INTERVAL == 0:
                self._save_checkpoint(episode)
            
            # Evaluation
            if episode % self.training_config.EVAL_INTERVAL == 0:
                self._evaluate(difficulty)
    
    def _update_networks(self, trajectory: List[Dict]):
        """Update PPO networks using full PPO algorithm with GAE."""
        # Calculate returns and advantages
        returns = self._calculate_returns(trajectory)
        advantages = self._calculate_advantages(trajectory, returns)
        
        # Normalize advantages
        advantages = np.array(advantages)
        advantages = (advantages - np.mean(advantages)) / (np.std(advantages) + 1e-8)
        
        # Update each stalker's network
        for stalker_idx, stalker in enumerate(self.env.swarm.stalkers):
            # Prepare batch data
            states = [step['states'][stalker_idx] for step in trajectory]
            actions = [step['actions'][stalker_idx] for step in trajectory]
            old_log_probs = [action.log_prob for action in actions]
            action_indices = [action.action_idx for action in actions]
            
            # Convert to tensors
            old_log_probs_tensor = torch.stack(old_log_probs).detach()
            advantages_tensor = torch.tensor(advantages, dtype=torch.float32)
            returns_tensor = torch.tensor(returns, dtype=torch.float32)
            
            # PPO update with multiple epochs
            for epoch in range(self.training_config.UPDATE_EPOCHS):
                # Evaluate actions
                log_probs, values, entropy = stalker.ppo_network.evaluate_actions(
                    states, action_indices
                )
                
                # Calculate ratio
                ratio = torch.exp(log_probs - old_log_probs_tensor)
                
                # Clipped surrogate objective
                surr1 = ratio * advantages_tensor
                surr2 = torch.clamp(
                    ratio, 
                    1 - self.training_config.CLIP_EPSILON,
                    1 + self.training_config.CLIP_EPSILON
                ) * advantages_tensor
                
                # Policy loss
                policy_loss = -torch.min(surr1, surr2).mean()
                
                # Value loss
                value_loss = nn.functional.mse_loss(values.squeeze(), returns_tensor)
                
                # Entropy bonus (for exploration)
                entropy_loss = -entropy.mean() * 0.01
                
                # Total loss
                loss = policy_loss + 0.5 * value_loss + entropy_loss
                
                # Optimize
                stalker.ppo_network.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(stalker.ppo_network.parameters(), 0.5)
                stalker.ppo_network.optimizer.step()
    
    def _calculate_returns(self, trajectory: List[Dict]) -> List[float]:
        """Calculate discounted returns."""
        returns = []
        R = 0
        for step in reversed(trajectory):
            R = step['reward'] + self.training_config.GAMMA * R
            returns.insert(0, R)
        return returns
    
    def _calculate_advantages(self, trajectory: List[Dict], returns: List[float]) -> List[float]:
        """Calculate GAE (Generalized Advantage Estimation)."""
        advantages = []
        gae = 0
        values = []
        
        # Estimate values for each state
        for step in trajectory:
            step_values = []
            for stalker in step['states']:
                with torch.no_grad():
                    _, value = stalker.ppo_network.forward({
                        'target_dx': 0.0,
                        'target_dy': 0.0,
                        'obstacle_ahead': False
                    })
                    step_values.append(value.item())
            values.append(np.mean(step_values))
        
        # Calculate GAE
        for t in reversed(range(len(trajectory))):
            delta = trajectory[t]['reward'] + self.training_config.GAMMA * (
                values[t + 1] if t < len(values) - 1 else 0
            ) - values[t]
            gae = delta + self.training_config.GAMMA * self.training_config.GAE_LAMBDA * gae
            advantages.insert(0, gae)
        
        return advantages
    
    def _evaluate(self, difficulty: DifficultyMode):
        """Evaluate current policy."""
        print(f"\n--- Evaluation at Episode {len(self.episode_rewards)} ---")
        eval_rewards = []
        eval_catches = 0
        
        for _ in range(self.training_config.EVAL_EPISODES):
            obs = self.env.reset(difficulty)
            episode_reward = 0
            
            for _ in range(self.training_config.MAX_STEPS_PER_EPISODE):
                _, reward, done, info = self.env.step()
                episode_reward += reward
                if done:
                    if info.get('caught', False):
                        eval_catches += 1
                    break
            
            eval_rewards.append(episode_reward)
        
        avg_reward = np.mean(eval_rewards)
        catch_rate = eval_catches / self.training_config.EVAL_EPISODES
        print(f"Evaluation - Avg Reward: {avg_reward:.2f}, Catch Rate: {catch_rate:.2%}\n")
    
    def _save_checkpoint(self, episode: int):
        """Save training checkpoint."""
        checkpoint = {
            'episode': episode,
            'episode_rewards': self.episode_rewards,
            'episode_lengths': self.episode_lengths,
            'catch_rates': self.catch_rates,
            'config': {
                'training': self.training_config.__dict__,
                'stalker': self.stalker_config.__dict__
            }
        }
        
        filename = f"checkpoint_ep{episode}.json"
        try:
            with open(filename, 'w') as f:
                json.dump(checkpoint, f, indent=2)
            print(f"Saved checkpoint: {filename}")
        except Exception as e:
            print(f"Failed to save checkpoint: {e}")


# ── Main Training Entry Point ───────────────────────────────────────────────────

def main():
    """Main training entry point."""
    # Configuration
    training_config = TrainingConfig(
        NUM_EPISODES=500,
        MAX_STEPS_PER_EPISODE=500,
        SAVE_INTERVAL=50,
        EVAL_INTERVAL=25,
        PLAYER_SKILL_LEVEL=0.7
    )
    
    stalker_config = StalkerConfig()
    
    # Create trainer
    trainer = PPOTrainer(training_config, stalker_config)
    
    # Train on different difficulties
    print("=" * 60)
    print("Phase 1: Training on NORMAL difficulty")
    print("=" * 60)
    trainer.train(DifficultyMode.NORMAL)
    
    print("\n" + "=" * 60)
    print("Phase 2: Training on HARD difficulty")
    print("=" * 60)
    trainer.train(DifficultyMode.HARD)
    
    print("\n" + "=" * 60)
    print("Phase 3: Training on YOU_ASKED_FOR_THIS difficulty")
    print("=" * 60)
    trainer.train(DifficultyMode.YOU_ASKED_FOR_THIS)
    
    print("\nTraining complete!")


if __name__ == "__main__":
    import math
    main()
