"""
Stalker AI System - Python Implementation
Advanced swarm intelligence using PPO, MCTS, and CommNet architecture.
"""

import math
import random
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional, Set
from enum import Enum
from collections import deque
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.distributions import Categorical


# ── Configuration ────────────────────────────────────────────────────────────────

class DifficultyMode(Enum):
    NORMAL = "normal"
    HARD = "hard"
    YOU_ASKED_FOR_THIS = "you_asked_for_this"


@dataclass
class StalkerConfig:
    # Movement settings
    BASE_SPEED: float = 1.0
    BASE_SIGHT_RANGE: float = 5.0
    BASE_HEARING_RANGE: float = 4.0
    BASE_SIGHT_CONE: float = math.pi / 3
    CATCH_RADIUS: float = 1.0
    
    # Pathfinding
    PATH_UPDATE_INTERVAL: int = 30
    MAX_PATH_LENGTH: int = 100
    REPATH_ON_BLOCKED: bool = True
    
    # Behavior multipliers
    PATROL_SPEED_MULTIPLIER: float = 0.5
    CHASE_SPEED_MULTIPLIER: float = 1.5
    SEARCH_SPEED_MULTIPLIER: float = 0.8
    
    # Memory
    NOISE_MEMORY_DURATION: int = 120
    SIGHT_MEMORY_DURATION: int = 60
    MAX_MEMORY_ENTRIES: int = 10
    
    # State transitions
    CHASE_SIGHT_THRESHOLD: float = 0.8
    SEARCH_DURATION: int = 180
    PATROL_NODE_SWITCH_INTERVAL: int = 240
    
    # Map bounds
    MIN_X: int = 0
    MAX_X: int = 27
    MIN_Y: int = 0
    MAX_Y: int = 9
    
    # PPO settings
    PPO_LEARNING_RATE: float = 0.0003
    PPO_GAMMA: float = 0.99
    PPO_GAE_LAMBDA: float = 0.95
    PPO_CLIP_EPSILON: float = 0.2
    PPO_UPDATE_EPOCHS: int = 10
    
    # MCTS settings
    MCTS_SIMULATIONS: int = 100
    MCTS_EXPLORATION_CONSTANT: float = 1.414
    MCTS_PREDICTION_HORIZON: int = 10  # 5-10 seconds ahead
    
    # CommNet settings
    COMMNET_BELIEF_DECAY: float = 0.95
    COMMNET_LATENCY_TICKS: int = 5
    COMMNET_CONFIDENCE_THRESHOLD: float = 0.7


# ── Zone Definitions ─────────────────────────────────────────────────────────────

@dataclass
class Zone:
    id: int
    name: str
    x: int
    y: int


# Zone mappings from the specification
ZONES = {
    0: Zone(0, "Entrance Hall", 5, 5),
    1: Zone(1, "Corridors", 10, 5),
    9: Zone(9, "Attic", 15, 2),
    10: Zone(10, "Basement", 3, 8),
    14: Zone(14, "Wine Cellar", 12, 7),
    18: Zone(18, "Nursery", 18, 6),
    19: Zone(19, "Ballroom", 20, 5),
    21: Zone(21, "Catacombs", 8, 3),
    26: Zone(26, "Hall of Mirrors", 22, 4),
    28: Zone(28, "Research Chamber", 25, 3),
    29: Zone(29, "The Void", 27, 1),
}


# ── PPO Layer: The Muscle ─────────────────────────────────────────────────────────

@dataclass
class PPOAction:
    dx: int
    dy: int
    log_prob: torch.Tensor
    value: torch.Tensor
    action_idx: int


class PPONetwork(nn.Module):
    """Proximal Policy Optimization with 20M parameter neural network."""
    
    def __init__(self, config: StalkerConfig, state_dim: int = 64, action_dim: int = 5):
        super().__init__()
        self.config = config
        self.action_dim = action_dim
        self.action_space = [(0, 1), (0, -1), (1, 0), (-1, 0), (0, 0)]  # N, S, E, W, Wait
        
        # Feature extraction layers
        self.feature_net = nn.Sequential(
            nn.Linear(state_dim, 512),
            nn.LayerNorm(512),
            nn.ReLU(),
            nn.Linear(512, 1024),
            nn.LayerNorm(1024),
            nn.ReLU(),
            nn.Linear(1024, 1536),
            nn.LayerNorm(1536),
            nn.ReLU(),
        )
        
        # Policy network (actor) - scaled for ~10M params
        self.policy_net = nn.Sequential(
            nn.Linear(1536, 2048),
            nn.LayerNorm(2048),
            nn.ReLU(),
            nn.Linear(2048, 2560),
            nn.LayerNorm(2560),
            nn.ReLU(),
            nn.Linear(2560, 2048),
            nn.LayerNorm(2048),
            nn.ReLU(),
            nn.Linear(2048, 1536),
            nn.LayerNorm(1536),
            nn.ReLU(),
            nn.Linear(1536, 1024),
            nn.LayerNorm(1024),
            nn.ReLU(),
            nn.Linear(1024, action_dim),
        )
        
        # Value network (critic) - scaled for ~10M params
        self.value_net = nn.Sequential(
            nn.Linear(1536, 2048),
            nn.LayerNorm(2048),
            nn.ReLU(),
            nn.Linear(2048, 2560),
            nn.LayerNorm(2560),
            nn.ReLU(),
            nn.Linear(2560, 2048),
            nn.LayerNorm(2048),
            nn.ReLU(),
            nn.Linear(2048, 1536),
            nn.LayerNorm(1536),
            nn.ReLU(),
            nn.Linear(1536, 1024),
            nn.LayerNorm(1024),
            nn.ReLU(),
            nn.Linear(1024, 1),
        )
        
        # Initialize weights
        self._initialize_weights()
        
        # Optimizer
        self.optimizer = optim.Adam(
            self.parameters(), 
            lr=config.PPO_LEARNING_RATE,
            eps=1e-5
        )
    
    def _initialize_weights(self):
        """Initialize network weights using orthogonal initialization."""
        for module in self.modules():
            if isinstance(module, (nn.Linear, nn.Conv2d)):
                nn.init.orthogonal_(module.weight, gain=np.sqrt(2))
                if module.bias is not None:
                    nn.init.constant_(module.bias, 0)
            elif isinstance(module, nn.LayerNorm):
                nn.init.constant_(module.weight, 1)
                nn.init.constant_(module.bias, 0)
    
    def _encode_state(self, state: Dict) -> torch.Tensor:
        """Encode state dictionary into fixed-size vector."""
        # Extract and normalize features
        target_dx = state.get('target_dx', 0.0) / 27.0  # Normalize by map width
        target_dy = state.get('target_dy', 0.0) / 9.0   # Normalize by map height
        obstacle_ahead = 1.0 if state.get('obstacle_ahead', False) else 0.0
        
        # Create feature vector with positional encoding
        features = torch.zeros(64)
        features[0] = target_dx
        features[1] = target_dy
        features[2] = obstacle_ahead
        features[3] = math.sqrt(target_dx**2 + target_dy**2)  # Distance to target
        features[4] = math.atan2(target_dy, target_dx) / math.pi  # Angle to target
        
        # Sinusoidal positional encoding for remaining dimensions
        for i in range(5, 64):
            freq = 10000 ** (2 * (i // 2) / 64)
            if i % 2 == 0:
                features[i] = math.sin(i / freq)
            else:
                features[i] = math.cos(i / freq)
        
        return features
    
    def forward(self, state: Dict) -> Tuple[torch.Tensor, torch.Tensor]:
        """Forward pass: returns action logits and value."""
        state_tensor = self._encode_state(state)
        features = self.feature_net(state_tensor)
        
        action_logits = self.policy_net(features)
        value = self.value_net(features)
        
        return action_logits, value.squeeze()
    
    def select_action(self, state: Dict, deterministic: bool = False) -> PPOAction:
        """Select action using current policy."""
        with torch.no_grad():
            action_logits, value = self.forward(state)
            
            # Apply softmax to get probabilities
            action_probs = torch.softmax(action_logits, dim=-1)
            
            if deterministic:
                action_idx = torch.argmax(action_probs).item()
            else:
                dist = Categorical(action_probs)
                action_idx = dist.sample().item()
            
            log_prob = torch.log(action_probs[action_idx] + 1e-8)
            
            dx, dy = self.action_space[action_idx]
            
            return PPOAction(dx, dy, log_prob, value, action_idx)
    
    def evaluate_actions(self, states: List[Dict], action_indices: List[int]) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Evaluate actions for PPO update."""
        action_logits_list = []
        values_list = []
        
        for state in states:
            state_tensor = self._encode_state(state)
            features = self.feature_net(state_tensor)
            action_logits = self.policy_net(features)
            value = self.value_net(features)
            action_logits_list.append(action_logits)
            values_list.append(value.squeeze())
        
        action_logits = torch.stack(action_logits_list)
        values = torch.stack(values_list).squeeze()
        
        action_probs = torch.softmax(action_logits, dim=-1)
        dist = Categorical(action_probs)
        
        action_indices_tensor = torch.tensor(action_indices, dtype=torch.long)
        log_probs = dist.log_prob(action_indices_tensor)
        entropy = dist.entropy()
        
        return log_probs, values, entropy
    
    def get_parameter_count(self) -> int:
        """Return total number of parameters."""
        return sum(p.numel() for p in self.parameters())


# ── MCTS Layer: The Brain ─────────────────────────────────────────────────────────

@dataclass
class MCTSNode:
    position: Tuple[int, int]
    parent: Optional['MCTSNode'] = None
    children: List['MCTSNode'] = field(default_factory=list)
    visits: int = 0
    value: float = 0.0
    untried_actions: List[Tuple[int, int]] = field(default_factory=list)


class MCTS:
    """Monte Carlo Tree Search for predictive player path simulation."""
    
    def __init__(self, config: StalkerConfig):
        self.config = config
        
    def predict_player_position(
        self, 
        current_pos: Tuple[int, int], 
        player_pos: Tuple[int, int],
        tile_at_func,
        blocked_tiles: List[int],
        horizon: int = None,
        player_velocity: Optional[Tuple[float, float]] = None
    ) -> Tuple[int, int]:
        """Predict where player will be in 5-10 seconds using MCTS."""
        if horizon is None:
            horizon = self.config.MCTS_PREDICTION_HORIZON
            
        root = MCTSNode(current_pos)
        root.untried_actions = self._get_valid_actions(current_pos, tile_at_func, blocked_tiles)
        
        # Run simulations
        for _ in range(self.config.MCTS_SIMULATIONS):
            node = root
            
            # Selection - traverse tree using UCB1
            while node.untried_actions == [] and node.children:
                node = self._select_child(node)
            
            # Expansion - add new child if possible
            if node.untried_actions:
                action = node.untried_actions.pop()
                new_pos = (node.position[0] + action[0], node.position[1] + action[1])
                child = MCTSNode(new_pos, parent=node)
                child.untried_actions = self._get_valid_actions(new_pos, tile_at_func, blocked_tiles)
                node.children.append(child)
                node = child
            
            # Simulation - roll out to horizon
            predicted_pos = self._simulate(
                node.position, 
                player_pos, 
                horizon, 
                tile_at_func, 
                blocked_tiles,
                player_velocity
            )
            
            # Backpropagation - update statistics up the tree
            reward = self._calculate_reward(predicted_pos, player_pos)
            while node is not None:
                node.visits += 1
                node.value += reward
                node = node.parent
        
        # Select best action based on visit count (robust choice)
        if root.children:
            best_child = max(root.children, key=lambda c: c.visits)
            return best_child.position
        return current_pos
    
    def _get_valid_actions(self, pos: Tuple[int, int], tile_at_func, blocked_tiles: List[int]) -> List[Tuple[int, int]]:
        """Get valid movement actions from position."""
        actions = [(0, 1), (0, -1), (1, 0), (-1, 0)]
        valid = []
        for dx, dy in actions:
            new_x, new_y = pos[0] + dx, pos[1] + dy
            if (self.config.MIN_X <= new_x <= self.config.MAX_X and 
                self.config.MIN_Y <= new_y <= self.config.MAX_Y):
                tile = tile_at_func(new_x, new_y)
                if tile not in blocked_tiles:
                    valid.append((dx, dy))
        return valid
    
    def _select_child(self, node: MCTSNode) -> MCTSNode:
        """Select child using UCB1 formula."""
        best_score = -float('inf')
        best_child = None
        
        for child in node.children:
            if child.visits == 0:
                return child
            
            exploitation = child.value / child.visits
            exploration = self.config.MCTS_EXPLORATION_CONSTANT * math.sqrt(
                math.log(node.visits) / child.visits
            )
            score = exploitation + exploration
            
            if score > best_score:
                best_score = score
                best_child = child
        
        return best_child
    
    def _simulate(
        self, 
        stalker_pos: Tuple[int, int], 
        player_pos: Tuple[int, int],
        depth: int,
        tile_at_func,
        blocked_tiles: List[int],
        player_velocity: Optional[Tuple[float, float]] = None
    ) -> Tuple[int, int]:
        """Simulate player movement for prediction using momentum and avoidance."""
        current_x, current_y = player_pos
        
        # Use provided velocity or calculate from stalker position
        if player_velocity is not None:
            vx, vy = player_velocity
        else:
            # Player tends to move away from stalker
            dx = player_pos[0] - stalker_pos[0]
            dy = player_pos[1] - stalker_pos[1]
            dist = math.sqrt(dx*dx + dy*dy) + 1e-6
            vx = (dx / dist) * 0.8  # Normalized velocity
            vy = (dy / dist) * 0.8
        
        # Simulate movement over depth steps
        for _ in range(depth):
            # Add some randomness to simulate imperfect prediction
            noise_x = random.gauss(0, 0.3)
            noise_y = random.gauss(0, 0.3)
            
            next_x = current_x + vx + noise_x
            next_y = current_y + vy + noise_y
            
            # Check if next position is valid
            if (self.config.MIN_X <= next_x <= self.config.MAX_X and 
                self.config.MIN_Y <= next_y <= self.config.MAX_Y):
                tile = tile_at_func(int(round(next_x)), int(round(next_y)))
                if tile not in blocked_tiles:
                    current_x, current_y = next_x, next_y
                else:
                    # Bounce off obstacles
                    vx = -vx * 0.5
                    vy = -vy * 0.5
            else:
                # Bounce off walls
                if next_x < self.config.MIN_X or next_x > self.config.MAX_X:
                    vx = -vx
                if next_y < self.config.MIN_Y or next_y > self.config.MAX_Y:
                    vy = -vy
        
        # Clamp to bounds
        predicted_x = max(self.config.MIN_X, min(self.config.MAX_X, int(round(current_x))))
        predicted_y = max(self.config.MIN_Y, min(self.config.MAX_Y, int(round(current_y))))
        
        return (predicted_x, predicted_y)
    
    def _calculate_reward(self, predicted_pos: Tuple[int, int], player_pos: Tuple[int, int]) -> float:
        """Calculate reward for prediction accuracy."""
        distance = math.sqrt(
            (predicted_pos[0] - player_pos[0])**2 + 
            (predicted_pos[1] - player_pos[1])**2
        )
        return 1.0 / (1.0 + distance)


# ── CommNet Layer: The Hive Mind ─────────────────────────────────────────────────

@dataclass
class BeliefState:
    player_position: Optional[Tuple[int, int]] = None
    confidence: float = 0.0
    last_update: int = 0
    source_agent: int = -1
    zone_activity: Dict[int, float] = field(default_factory=dict)  # zone_id -> activity level


class CommNet:
    """Communication Network for belief state sharing between agents."""
    
    def __init__(self, config: StalkerConfig, num_agents: int = 3):
        self.config = config
        self.num_agents = num_agents
        self.belief_states: Dict[int, BeliefState] = {i: BeliefState() for i in range(num_agents)}
        self.shared_belief = BeliefState()
        self.message_queue: List[Dict] = []
        
    def broadcast_belief(self, agent_id: int, belief: BeliefState, current_tick: int):
        """Agent broadcasts its belief state to the network."""
        message = {
            'agent_id': agent_id,
            'belief': belief,
            'tick': current_tick
        }
        self.message_queue.append(message)
        
        # Update shared belief with confidence weighting
        if belief.confidence > self.config.COMMNET_CONFIDENCE_THRESHOLD:
            self._update_shared_belief(belief, current_tick)
    
    def receive_belief(self, agent_id: int, current_tick: int) -> BeliefState:
        """Agent receives updated belief from network."""
        # Process messages with latency simulation
        relevant_messages = [
            m for m in self.message_queue 
            if m['agent_id'] != agent_id and 
            current_tick - m['tick'] >= self.config.COMMNET_LATENCY_TICKS
        ]
        
        if relevant_messages:
            # Aggregate beliefs from other agents
            aggregated = self._aggregate_beliefs(relevant_messages)
            self.belief_states[agent_id] = aggregated
        
        # Decay belief over time
        self._decay_belief(self.belief_states[agent_id])
        
        return self.belief_states[agent_id]
    
    def _update_shared_belief(self, new_belief: BeliefState, current_tick: int):
        """Update shared belief with new information."""
        # Weighted average based on confidence
        if self.shared_belief.confidence > 0:
            alpha = new_belief.confidence / (new_belief.confidence + self.shared_belief.confidence)
            if new_belief.player_position and self.shared_belief.player_position:
                self.shared_belief.player_position = (
                    int(alpha * new_belief.player_position[0] + (1 - alpha) * self.shared_belief.player_position[0]),
                    int(alpha * new_belief.player_position[1] + (1 - alpha) * self.shared_belief.player_position[1])
                )
            self.shared_belief.confidence = alpha * new_belief.confidence + (1 - alpha) * self.shared_belief.confidence
        else:
            self.shared_belief = new_belief
        
        self.shared_belief.last_update = current_tick
        
        # Merge zone activity
        for zone_id, activity in new_belief.zone_activity.items():
            self.shared_belief.zone_activity[zone_id] = max(
                self.shared_belief.zone_activity.get(zone_id, 0),
                activity
            )
    
    def _aggregate_beliefs(self, messages: List[Dict]) -> BeliefState:
        """Aggregate beliefs from multiple agents."""
        if not messages:
            return BeliefState()
        
        # Weight by confidence and recency
        total_weight = 0
        weighted_x = 0
        weighted_y = 0
        zone_activity = {}
        
        for msg in messages:
            belief = msg['belief']
            weight = belief.confidence
            total_weight += weight
            
            if belief.player_position:
                weighted_x += weight * belief.player_position[0]
                weighted_y += weight * belief.player_position[1]
            
            for zone_id, activity in belief.zone_activity.items():
                zone_activity[zone_id] = max(zone_activity.get(zone_id, 0), activity)
        
        aggregated = BeliefState()
        if total_weight > 0:
            aggregated.player_position = (int(weighted_x / total_weight), int(weighted_y / total_weight))
            aggregated.confidence = total_weight / len(messages)
            aggregated.zone_activity = zone_activity
        
        return aggregated
    
    def _decay_belief(self, belief: BeliefState):
        """Decay belief confidence over time."""
        belief.confidence *= self.config.COMMNET_BELIEF_DECAY
        
        for zone_id in belief.zone_activity:
            belief.zone_activity[zone_id] *= self.config.COMMNET_BELIEF_DECAY
        
        # Remove low-confidence entries
        belief.zone_activity = {
            k: v for k, v in belief.zone_activity.items() 
            if v > 0.1
        }
    
    def coordinate_pincer_maneuver(
        self, 
        agent_positions: Dict[int, Tuple[int, int]],
        player_position: Optional[Tuple[int, int]] = None
    ) -> Dict[int, Tuple[int, int]]:
        """Coordinate pincer maneuver to trap player using optimal positioning."""
        positions = list(agent_positions.values())
        
        if player_position is not None:
            # Use player position as target for pincer
            target_x, target_y = player_position
        else:
            # Find centroid of agent positions as fallback
            centroid_x = sum(p[0] for p in positions) / len(positions)
            centroid_y = sum(p[1] for p in positions) / len(positions)
            target_x, target_y = centroid_x, centroid_y
        
        # Calculate optimal pincer positions (triangle formation)
        assignments = {}
        
        # Sort agents by distance to target
        sorted_agents = sorted(
            agent_positions.items(),
            key=lambda x: math.sqrt((x[1][0] - target_x)**2 + (x[1][1] - target_y)**2)
        )
        
        if len(sorted_agents) >= 3:
            # Triangle formation
            # Agent 0: Direct pursuit (closest)
            assignments[sorted_agents[0][0]] = (target_x, target_y)
            
            # Agent 1: Left flank
            flank_distance = 3
            assignments[sorted_agents[1][0]] = (
                max(self.config.MIN_X, target_x - flank_distance),
                target_y
            )
            
            # Agent 2: Right flank
            assignments[sorted_agents[2][0]] = (
                min(self.config.MAX_X, target_x + flank_distance),
                target_y
            )
            
            # Additional agents: spread out
            for i in range(3, len(sorted_agents)):
                angle = (2 * math.pi * i) / (len(sorted_agents) - 2)
                radius = 4
                assignments[sorted_agents[i][0]] = (
                    int(round(target_x + radius * math.cos(angle))),
                    int(round(target_y + radius * math.sin(angle)))
                )
        else:
            # Fallback: simple spread
            for i, (agent_id, pos) in enumerate(sorted_agents):
                offset_x = 2 if i % 2 == 0 else -2
                offset_y = 2 if i >= 2 else -2
                assignments[agent_id] = (
                    max(self.config.MIN_X, min(self.config.MAX_X, target_x + offset_x)),
                    max(self.config.MIN_Y, min(self.config.MAX_Y, target_y + offset_y))
                )
        
        return assignments


# ── Agent Roles (Elite Trio) ─────────────────────────────────────────────────────

class AgentRole(Enum):
    ARCHITECT = "architect"  # Strategic lead, MCTS-focused
    HOUND = "hound"          # Aggressor, PPO-focused
    GHOST = "ghost"          # Saboteur, stealth-focused


@dataclass
class RoleConstraints:
    """Explicit constraints to prevent personality drift during training."""
    max_engagement_distance: float  # Max distance before forced engagement
    min_patience_ticks: int         # Minimum ticks before engaging
    max_movement_per_tick: float    # Movement speed cap
    stealth_detection_range: float   # Range at which ghost becomes visible
    mcts_allocation: float          # Portion of MCTS cycles allocated
    ppo_aggression_factor: float     # Multiplier for PPO exploration
    territory_bounds: Optional[Tuple[int, int, int, int]]  # (min_x, max_x, min_y, max_y)


# Role-specific constraints
ROLE_CONSTRAINTS = {
    AgentRole.ARCHITECT: RoleConstraints(
        max_engagement_distance=15.0,  # Stays back, strategic
        min_patience_ticks=50,         # Patient, calculating
        max_movement_per_tick=0.8,     # Slower, deliberate
        stealth_detection_range=10.0,  # Visible from afar
        mcts_allocation=0.6,           # 60% of MCTS cycles
        ppo_aggression_factor=0.5,     # Conservative movement
        territory_bounds=(20, 27, 1, 5)  # Research Chamber/Ballroom area
    ),
    AgentRole.HOUND: RoleConstraints(
        max_engagement_distance=3.0,   # Always close to player
        min_patience_ticks=0,           # Immediate engagement
        max_movement_per_tick=1.5,     # Fast, aggressive
        stealth_detection_range=15.0,  # Always visible
        mcts_allocation=0.2,           # 20% of MCTS cycles
        ppo_aggression_factor=1.5,     # Aggressive exploration
        territory_bounds=None          # Free movement
    ),
    AgentRole.GHOST: RoleConstraints(
        max_engagement_distance=8.0,   # Waits for opportune moment
        min_patience_ticks=30,         # Waits before striking
        max_movement_per_tick=0.5,     # Slow, stealthy
        stealth_detection_range=3.0,   # Only visible within 3 tiles
        mcts_allocation=0.2,           # 20% of MCTS cycles
        ppo_aggression_factor=0.3,     # Minimal movement
        territory_bounds=(18, 24, 3, 7)  # Hall of Mirrors/Nursery area
    ),
}


# ── Stalker State ─────────────────────────────────────────────────────────────────

class StalkerState(Enum):
    PATROL = "patrol"
    CHASE = "chase"
    SEARCH = "search"
    WAIT = "wait"


@dataclass
class Stalker:
    id: int
    role: AgentRole  # Add role to stalker
    x: float
    y: float
    render_x: float = 0.0
    render_y: float = 0.0
    facing: str = "left"
    last_move_tick: int = 0
    move_tick: int = 0
    speed: float = 1.0
    state: StalkerState = StalkerState.PATROL
    target_x: Optional[float] = None
    target_y: Optional[float] = None
    path: List[Tuple[int, int]] = field(default_factory=list)
    path_index: int = 0
    recent_noises: List[Dict] = field(default_factory=list)
    last_player_sighting: Optional[Dict] = None
    known_player_position: Optional[Tuple[int, int]] = None
    patrol_node_index: int = 0
    patrol_nodes: List[Tuple[int, int]] = field(default_factory=list)
    has_line_of_sight: bool = False
    can_hear_player: bool = False
    detection_confidence: float = 0.0
    reflect_timer: int = 0
    confused: bool = False
    confused_timer: int = 0
    zone_speed: float = 1.0
    zone_sight_range: float = 5.0
    zone_hearing_range: float = 4.0
    zone_sight_cone: float = math.pi / 3
    zone_predictive: bool = False
    patience_timer: int = 0  # For role-based patience
    stealth_ticks: int = 0    # For ghost stealth tracking
    
    # AI components
    ppo_network: Optional[PPONetwork] = None
    belief_state: Optional[BeliefState] = None
    constraints: Optional[RoleConstraints] = None


# ── Swarm Manager ────────────────────────────────────────────────────────────────

class SwarmManager:
    """Manages the entire swarm of Stalkers with strategic spawning."""
    
    def __init__(self, config: StalkerConfig, difficulty: DifficultyMode = DifficultyMode.NORMAL):
        self.config = config
        self.difficulty = difficulty
        self.stalkers: List[Stalker] = []
        self.commnet = CommNet(config, num_agents=3)
        self.player_keys_collected: int = 0
        self.dynamic_spawn_enabled: bool = True
        
    def spawn_swarm(self) -> List[Stalker]:
        """Spawn stalkers based on difficulty mode with Elite Trio roles."""
        spawn_configs = self._get_spawn_configuration()
        
        self.stalkers = []
        for i, (zone_id, role) in enumerate(spawn_configs):
            zone = ZONES[zone_id]
            constraints = ROLE_CONSTRAINTS[role]
            
            stalker = Stalker(
                id=i,
                role=role,
                x=float(zone.x),
                y=float(zone.y),
                render_x=float(zone.x),
                render_y=float(zone.y),
                constraints=constraints
            )
            
            # Initialize AI components
            stalker.ppo_network = PPONetwork(self.config)
            stalker.belief_state = BeliefState()
            
            # Apply role-specific parameters
            stalker.zone_speed = self._get_role_speed(role)
            stalker.zone_sight_range = self._get_role_sight_range(role)
            stalker.zone_hearing_range = self._get_role_hearing_range(role)
            stalker.zone_sight_cone = self._get_role_sight_cone(role)
            stalker.zone_predictive = (role == AgentRole.ARCHITECT)
            
            # Initialize patience timer
            stalker.patience_timer = constraints.min_patience_ticks
            
            self.stalkers.append(stalker)
        
        return self.stalkers
    
    def _get_spawn_configuration(self) -> List[Tuple[int, AgentRole]]:
        """Get spawn zones and roles based on difficulty."""
        if self.difficulty == DifficultyMode.NORMAL:
            # All in The Void (Zone 29) - all Hounds for basic pressure
            return [(29, AgentRole.HOUND), (29, AgentRole.HOUND), (29, AgentRole.HOUND)]
        
        elif self.difficulty == DifficultyMode.HARD:
            # One in Void (Hound), two in Catacombs (Architect + Ghost)
            return [(29, AgentRole.HOUND), (21, AgentRole.ARCHITECT), (21, AgentRole.GHOST)]
        
        elif self.difficulty == DifficultyMode.YOU_ASKED_FOR_THIS:
            # Elite Trio Configuration
            return [
                (28, AgentRole.ARCHITECT),  # Research Chamber - The Architect
                (10, AgentRole.HOUND),       # Basement - The Hound
                (26, AgentRole.GHOST),       # Hall of Mirrors - The Ghost
            ]
        
        return [(29, AgentRole.HOUND), (29, AgentRole.HOUND), (29, AgentRole.HOUND)]
    
    def _get_role_speed(self, role: AgentRole) -> float:
        """Get movement speed based on role."""
        if role == AgentRole.HOUND:
            return self.config.BASE_SPEED * 1.5
        elif role == AgentRole.ARCHITECT:
            return self.config.BASE_SPEED * 0.8
        elif role == AgentRole.GHOST:
            return self.config.BASE_SPEED * 0.5
        return self.config.BASE_SPEED
    
    def _get_role_sight_range(self, role: AgentRole) -> float:
        """Get sight range based on role."""
        if role == AgentRole.ARCHITECT:
            return self.config.BASE_SIGHT_RANGE * 1.5  # Strategic vision
        elif role == AgentRole.HOUND:
            return self.config.BASE_SIGHT_RANGE * 1.2  # Focused vision
        elif role == AgentRole.GHOST:
            return self.config.BASE_SIGHT_RANGE * 0.8  # Tunnel vision
        return self.config.BASE_SIGHT_RANGE
    
    def _get_role_hearing_range(self, role: AgentRole) -> float:
        """Get hearing range based on role."""
        if role == AgentRole.ARCHITECT:
            return self.config.BASE_HEARING_RANGE * 1.3  # Strategic hearing
        elif role == AgentRole.HOUND:
            return self.config.BASE_HEARING_RANGE * 1.5  # Acute hearing
        elif role == AgentRole.GHOST:
            return self.config.BASE_HEARING_RANGE * 0.7  # Selective hearing
        return self.config.BASE_HEARING_RANGE
    
    def _get_role_sight_cone(self, role: AgentRole) -> float:
        """Get sight cone based on role."""
        if role == AgentRole.ARCHITECT:
            return self.config.BASE_SIGHT_CONE * 1.5  # Wide strategic view
        elif role == AgentRole.HOUND:
            return self.config.BASE_SIGHT_CONE * 0.8  # Focused pursuit
        elif role == AgentRole.GHOST:
            return self.config.BASE_SIGHT_CONE * 0.5  # Narrow ambush view
        return self.config.BASE_SIGHT_CONE
    
    def update_swarm(
        self, 
        player: Dict, 
        tile_at_func, 
        tick: int, 
        blocked_tiles: List[int]
    ) -> Dict:
        """Update all stalkers in the swarm."""
        results = {"caught": False}
        
        # Check for dynamic spawn shift
        if self.dynamic_spawn_enabled and self.player_keys_collected > 4:
            self._shift_spawn_points()
        
        # Update each stalker
        for stalker in self.stalkers:
            # Update belief state from CommNet
            stalker.belief_state = self.commnet.receive_belief(stalker.id, tick)
            
            # Run MCTS prediction with role-based allocation
            if stalker.zone_predictive and stalker.known_player_position:
                mcts = MCTS(self.config)
                # Architect gets more simulations
                simulations = int(self.config.MCTS_SIMULATIONS * stalker.constraints.mcts_allocation)
                mcts.MCTS_SIMULATIONS = simulations
                
                predicted_pos = mcts.predict_player_position(
                    (int(stalker.x), int(stalker.y)),
                    stalker.known_player_position,
                    tile_at_func,
                    blocked_tiles
                )
                stalker.target_x, stalker.target_y = predicted_pos
                
                # Architect broadcasts prediction via CommNet
                if stalker.role == AgentRole.ARCHITECT:
                    stalker.belief_state.zone_activity[28] = 1.0  # Mark Research Chamber
            
            # Update stalker
            result = self._update_stalker(stalker, player, tile_at_func, tick, blocked_tiles)
            
            # Broadcast belief if confident
            if stalker.belief_state.confidence > self.config.COMMNET_CONFIDENCE_THRESHOLD:
                self.commnet.broadcast_belief(stalker.id, stalker.belief_state, tick)
            
            if result.get("caught", False):
                results["caught"] = True
        
        # Coordinate pincer maneuvers
        if self.difficulty == DifficultyMode.YOU_ASKED_FOR_THIS:
            positions = {s.id: (int(s.x), int(s.y)) for s in self.stalkers}
            assignments = self.commnet.coordinate_pincer_maneuver(positions)
            for stalker in self.stalkers:
                if stalker.id in assignments:
                    stalker.target_x, stalker.target_y = assignments[stalker.id]
        
        return results
    
    def _shift_spawn_points(self):
        """Shift spawn points if player has collected >4 keys."""
        # Move stalkers closer to player's current progress
        # This prevents agents from getting "lazy" in early zones
        for stalker in self.stalkers:
            # Shift toward mid-game zones
            if stalker.x < 10:
                stalker.x = min(stalker.x + 5, 15)
            if stalker.y < 5:
                stalker.y = min(stalker.y + 3, 7)
        
        self.dynamic_spawn_enabled = False  # Only shift once
    
    def _update_stalker(
        self, 
        stalker: Stalker, 
        player: Dict, 
        tile_at_func, 
        tick: int, 
        blocked_tiles: List[int]
    ) -> Dict:
        """Update individual stalker with role-specific behavior."""
        # Apply role constraints
        self._enforce_role_constraints(stalker, player, tick)
        
        # Update sensory perception (Ghost stealth handling)
        stalker.has_line_of_sight = self._check_line_of_sight(stalker, player, tile_at_func)
        stalker.can_hear_player = self._check_hearing(stalker, player)
        
        # Ghost stealth: only visible within detection range
        if stalker.role == AgentRole.GHOST:
            dist = math.sqrt((player['x'] - stalker.x)**2 + (player['y'] - stalker.y)**2)
            if dist > stalker.constraints.stealth_detection_range:
                stalker.has_line_of_sight = False
                stalker.can_hear_player = False
                stalker.stealth_ticks += 1
            else:
                stalker.stealth_ticks = 0
        
        # Update detection confidence
        if stalker.has_line_of_sight:
            stalker.detection_confidence = min(1.0, stalker.detection_confidence + 0.1)
        else:
            stalker.detection_confidence = max(0.0, stalker.detection_confidence - 0.02)
        
        # Update sensory memory
        self._update_sensory_memory(stalker, player, tick)
        
        # Update AI state with role-specific logic
        self._update_ai_state(stalker, tick)
        
        # Calculate speed with role cap
        base_speed = self._calculate_speed(stalker)
        stalker.speed = min(base_speed, stalker.constraints.max_movement_per_tick)
        
        # Movement using PPO with role aggression factor
        moved = self._execute_movement(stalker, player, tile_at_func, blocked_tiles, tick)
        
        # Smooth position
        self._smooth_position(stalker)
        
        # Update effects
        if stalker.reflect_timer > 0:
            stalker.reflect_timer -= 1
        if stalker.confused:
            stalker.confused_timer -= 1
            if stalker.confused_timer <= 0:
                stalker.confused = False
        
        # Check catch (Ghost stealth bonus)
        distance = math.sqrt((player['x'] - stalker.x)**2 + (player['y'] - stalker.y)**2)
        if distance < self.config.CATCH_RADIUS and not player.get('hide', False):
            # Ghost gets stealth catch bonus
            if stalker.role == AgentRole.GHOST and stalker.stealth_ticks > 20:
                return {"caught": True, "stealth_catch": True}
            return {"caught": False}
        
        return {"caught": False}
    
    def _enforce_role_constraints(self, stalker: Stalker, player: Dict, tick: int):
        """Enforce role-specific constraints to prevent personality drift."""
        constraints = stalker.constraints
        
        # Territory bounds enforcement
        if constraints.territory_bounds is not None:
            min_x, max_x, min_y, max_y = constraints.territory_bounds
            stalker.x = max(min_x, min(max_x, stalker.x))
            stalker.y = max(min_y, min(max_y, stalker.y))
        
        # Engagement distance enforcement
        dist_to_player = math.sqrt((player['x'] - stalker.x)**2 + (player['y'] - stalker.y)**2)
        if stalker.role == AgentRole.ARCHITECT and dist_to_player < constraints.max_engagement_distance:
            # Architect retreats if too close
            dx = stalker.x - player['x']
            dy = stalker.y - player['y']
            norm = math.sqrt(dx*dx + dy*dy) + 1e-6
            stalker.x += (dx / norm) * 0.5
            stalker.y += (dy / norm) * 0.5
        
        # Patience timer enforcement
        if stalker.patience_timer > 0:
            stalker.patience_timer -= 1
            if stalker.role in [AgentRole.ARCHITECT, AgentRole.GHOST]:
                # Force wait state during patience
                stalker.state = StalkerState.WAIT
        
        # MCTS allocation enforcement
        if stalker.role == AgentRole.ARCHITECT:
            # Architect gets more MCTS cycles (handled in update_swarm)
            pass
        elif stalker.role == AgentRole.HOUND:
            # Hound gets fewer MCTS cycles, relies on PPO
            pass
        elif stalker.role == AgentRole.GHOST:
            # Ghost waits for Architect signal
            pass
    
    def _check_line_of_sight(self, stalker: Stalker, player: Dict, tile_at_func) -> bool:
        """Check if stalker has line of sight to player."""
        dx = player['x'] - stalker.x
        dy = player['y'] - stalker.y
        distance = math.sqrt(dx * dx + dy * dy)
        
        if distance > stalker.zone_sight_range:
            return False
        
        # Check sight cone
        angle = math.atan2(dy, dx)
        facing_angle = math.pi if stalker.facing == "left" else 0
        angle_diff = abs(angle - facing_angle)
        
        if angle_diff > stalker.zone_sight_cone:
            return False
        
        # Raycast
        steps = int(math.ceil(distance))
        for i in range(1, steps):
            check_x = stalker.x + (dx / steps) * i
            check_y = stalker.y + (dy / steps) * i
            tile = tile_at_func(int(round(check_x)), int(round(check_y)))
            if tile == 1:  # Wall
                return False
        
        return True
    
    def _check_hearing(self, stalker: Stalker, player: Dict) -> bool:
        """Check if stalker can hear player."""
        dx = player['x'] - stalker.x
        dy = player['y'] - stalker.y
        distance = math.sqrt(dx * dx + dy * dy)
        
        if distance > stalker.zone_hearing_range:
            return False
        
        return player.get('moved', False)
    
    def _update_sensory_memory(self, stalker: Stalker, player: Dict, tick: int):
        """Update stalker's sensory memory."""
        if stalker.can_hear_player:
            stalker.recent_noises.insert(0, {
                'x': player['x'],
                'y': player['y'],
                'ttl': self.config.NOISE_MEMORY_DURATION
            })
            if len(stalker.recent_noises) > self.config.MAX_MEMORY_ENTRIES:
                stalker.recent_noises.pop()
        
        if stalker.has_line_of_sight:
            stalker.last_player_sighting = {
                'x': player['x'],
                'y': player['y'],
                'tick': tick,
                'ttl': self.config.SIGHT_MEMORY_DURATION
            }
            stalker.known_player_position = (int(player['x']), int(player['y']))
            
            # Update belief state
            stalker.belief_state.player_position = stalker.known_player_position
            stalker.belief_state.confidence = stalker.detection_confidence
            stalker.belief_state.last_update = tick
        
        # Decay memories
        stalker.recent_noises = [n for n in stalker.recent_noises if n['ttl'] > 0]
        for noise in stalker.recent_noises:
            noise['ttl'] -= 1
        
        if stalker.last_player_sighting:
            stalker.last_player_sighting['ttl'] -= 1
            if stalker.last_player_sighting['ttl'] <= 0:
                stalker.last_player_sighting = None
    
    def _update_ai_state(self, stalker: Stalker, tick: int):
        """Update stalker's AI state machine."""
        has_sight = stalker.has_line_of_sight
        has_noise = len(stalker.recent_noises) > 0
        has_sighting = stalker.last_player_sighting is not None
        
        if stalker.state == StalkerState.PATROL:
            if has_sight and stalker.detection_confidence > self.config.CHASE_SIGHT_THRESHOLD:
                stalker.state = StalkerState.CHASE
            elif has_noise or has_sighting:
                stalker.state = StalkerState.SEARCH
        
        elif stalker.state == StalkerState.CHASE:
            if not has_sight and not has_sighting:
                stalker.state = StalkerState.SEARCH
                stalker.search_timer = self.config.SEARCH_DURATION
        
        elif stalker.state == StalkerState.SEARCH:
            if has_sight and stalker.detection_confidence > self.config.CHASE_SIGHT_THRESHOLD:
                stalker.state = StalkerState.CHASE
            elif stalker.search_timer <= 0:
                stalker.state = StalkerState.PATROL
            stalker.search_timer -= 1
        
        elif stalker.state == StalkerState.WAIT:
            if stalker.wait_timer <= 0:
                stalker.state = StalkerState.PATROL
            stalker.wait_timer -= 1
    
    def _calculate_speed(self, stalker: Stalker) -> float:
        """Calculate stalker speed based on state."""
        base = stalker.zone_speed
        if stalker.state == StalkerState.PATROL:
            return base * self.config.PATROL_SPEED_MULTIPLIER
        elif stalker.state == StalkerState.CHASE:
            return base * self.config.CHASE_SPEED_MULTIPLIER
        elif stalker.state == StalkerState.SEARCH:
            return base * self.config.SEARCH_SPEED_MULTIPLIER
        return base
    
    def _execute_movement(
        self, 
        stalker: Stalker, 
        player: Dict, 
        tile_at_func, 
        blocked_tiles: List[int],
        tick: int
    ) -> bool:
        """Execute movement using PPO and pathfinding."""
        if stalker.confused:
            return False
        
        # Prepare state for PPO
        target_x, target_y = self._get_movement_target(stalker)
        state = {
            'target_dx': target_x - stalker.x,
            'target_dy': target_y - stalker.y,
            'obstacle_ahead': not self._can_move_to(stalker.x, stalker.y, tile_at_func)
        }
        
        # Get PPO action
        action = stalker.ppo_network.select_action(state)
        
        # Apply movement
        new_x = stalker.x + action.dx
        new_y = stalker.y + action.dy
        
        if self._can_move_to(new_x, new_y, tile_at_func):
            stalker.x = new_x
            stalker.y = new_y
            if action.dx > 0:
                stalker.facing = "right"
            elif action.dx < 0:
                stalker.facing = "left"
            return True
        
        # Fallback to pathfinding
        if tick % self.config.PATH_UPDATE_INTERVAL == 0:
            self._update_path(stalker, tile_at_func, blocked_tiles)
        
        if stalker.path and stalker.path_index < len(stalker.path):
            next_node = stalker.path[stalker.path_index]
            if self._can_move_to(next_node[0], next_node[1], tile_at_func):
                stalker.x = float(next_node[0])
                stalker.y = float(next_node[1])
                stalker.path_index += 1
                return True
        
        return False
    
    def _get_movement_target(self, stalker: Stalker) -> Tuple[float, float]:
        """Get movement target based on state."""
        if stalker.state == StalkerState.CHASE and stalker.known_player_position:
            return stalker.known_player_position
        elif stalker.state == StalkerState.SEARCH:
            if stalker.known_player_position:
                return stalker.known_player_position
            elif stalker.recent_noises:
                noise = stalker.recent_noises[0]
                return (noise['x'], noise['y'])
        elif stalker.state == StalkerState.PATROL and stalker.patrol_nodes:
            node = stalker.patrol_nodes[stalker.patrol_node_index]
            return node
        elif stalker.target_x is not None and stalker.target_y is not None:
            return (stalker.target_x, stalker.target_y)
        
        return (stalker.x, stalker.y)
    
    def _can_move_to(self, x: float, y: float, tile_at_func) -> bool:
        """Check if position is walkable."""
        walkable_tiles = [0, 2, 5, 6, 10, 12, 15, 17, 20, 24]
        if not (self.config.MIN_X <= x <= self.config.MAX_X):
            return False
        if not (self.config.MIN_Y <= y <= self.config.MAX_Y):
            return False
        tile = tile_at_func(int(round(x)), int(round(y)))
        return tile in walkable_tiles
    
    def _update_path(self, stalker: Stalker, tile_at_func, blocked_tiles: List[int]):
        """Update path using BFS."""
        if not stalker.known_player_position:
            return
        
        start = (int(round(stalker.x)), int(round(stalker.y)))
        goal = stalker.known_player_position
        
        path = self._find_path(start, goal, tile_at_func, blocked_tiles)
        if path:
            stalker.path = path
            stalker.path_index = 0
    
    def _find_path(
        self, 
        start: Tuple[int, int], 
        goal: Tuple[int, int], 
        tile_at_func, 
        blocked_tiles: List[int]
    ) -> Optional[List[Tuple[int, int]]]:
        """BFS pathfinding."""
        from collections import deque
        
        queue = deque([(start, [])])
        visited = set([start])
        
        while queue:
            (x, y), path = queue.popleft()
            
            if (x, y) == goal:
                return path
            
            if len(path) > self.config.MAX_PATH_LENGTH:
                continue
            
            for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                nx, ny = x + dx, y + dy
                if (nx, ny) not in visited:
                    if (self.config.MIN_X <= nx <= self.config.MAX_X and 
                        self.config.MIN_Y <= ny <= self.config.MAX_Y):
                        tile = tile_at_func(nx, ny)
                        if tile not in blocked_tiles:
                            visited.add((nx, ny))
                            queue.append(((nx, ny), path + [(nx, ny)]))
        
        return None
    
    def _smooth_position(self, stalker: Stalker):
        """Smooth visual position."""
        smoothing = 0.2
        stalker.render_x += (stalker.x - stalker.render_x) * smoothing
        stalker.render_y += (stalker.y - stalker.render_y) * smoothing
        
        if abs(stalker.render_x - stalker.x) < 0.01:
            stalker.render_x = stalker.x
        if abs(stalker.render_y - stalker.y) < 0.01:
            stalker.render_y = stalker.y
    
    def set_player_keys(self, count: int):
        """Update player key count for dynamic spawning."""
        self.player_keys_collected = count


# ── Factory Functions ─────────────────────────────────────────────────────────────

def create_stalker_ai(difficulty: DifficultyMode = DifficultyMode.NORMAL) -> SwarmManager:
    """Factory function to create a stalker AI swarm."""
    config = StalkerConfig()
    return SwarmManager(config, difficulty)


def create_stalker_ai_custom(config: StalkerConfig, difficulty: DifficultyMode = DifficultyMode.NORMAL) -> SwarmManager:
    """Factory function with custom configuration."""
    return SwarmManager(config, difficulty)


# ── Export ───────────────────────────────────────────────────────────────────────

__all__ = [
    'StalkerConfig',
    'DifficultyMode',
    'Stalker',
    'StalkerState',
    'SwarmManager',
    'PPONetwork',
    'MCTS',
    'CommNet',
    'BeliefState',
    'create_stalker_ai',
    'create_stalker_ai_custom',
    'ZONES',
]
