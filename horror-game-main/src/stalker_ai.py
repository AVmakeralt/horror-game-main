"""
Stalker AI System - Python Implementation
Advanced swarm intelligence using PPO, MCTS, and CommNet architecture.
"""

import math
import random
import json
import time
import heapq
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional, Set, Any, Callable
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
    
    # VIL2C settings (VoI-Aware Communication)
    VIL2C_ENABLED: bool = True
    VIL2C_HIGH_VOI_THRESHOLD: float = 0.8
    VIL2C_LOW_VOI_THRESHOLD: float = 0.3
    VIL2C_MESSAGE_QUEUE_SIZE: int = 100
    
    # Network Slicing settings
    NETWORK_SLICING_ENABLED: bool = True
    CRITICAL_BANDWIDTH_ALLOCATION: float = 0.7  # 70% for mission-critical


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


# ── VIL2C CommNet Layer: 2026 Gold Standard Communication ────────────────────────

@dataclass
class BeliefState:
    player_position: Optional[Tuple[int, int]] = None
    confidence: float = 0.0
    last_update: int = 0
    source_agent: int = -1
    zone_activity: Dict[int, float] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)  # Extended state tracking


@dataclass
class VoIMessage:
    """Value-of-Information aware message with priority."""
    message_id: str
    sender_id: int
    receiver_id: Optional[int]  # None = broadcast
    voi_score: float  # 0.0 to 1.0
    message_type: str  # "player_sighting", "heartbeat", "coordination", "deception"
    payload: Dict[str, Any]
    timestamp: float
    tick: int
    compressed: bool = False
    progressive_chunks: List[Dict] = field(default_factory=list)
    current_chunk: int = 0


class NetworkSlice:
    """Network slice for mission-critical traffic isolation."""
    
    def __init__(self, name: str, bandwidth_allocation: float, priority: int):
        self.name = name
        self.bandwidth_allocation = bandwidth_allocation
        self.priority = priority
        self.message_queue: List[VoIMessage] = []
        self.bandwidth_used: float = 0.0
        self.max_bandwidth: float = bandwidth_allocation * 1000  # Abstract units


class A2AProtocol:
    """Agent-to-Agent Protocol (HTTP/JSON-RPC style for 2026 standard)."""
    
    @staticmethod
    def create_request(
        method: str,
        params: Dict[str, Any],
        request_id: str,
        sender_id: int
    ) -> str:
        """Create JSON-RPC 2.0 style request."""
        request = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": request_id,
            "sender_id": sender_id,
            "timestamp": time.time()
        }
        return json.dumps(request)
    
    @staticmethod
    def parse_response(response: str) -> Dict:
        """Parse JSON-RPC response."""
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            return {"error": "Invalid JSON"}
    
    @staticmethod
    def create_error_response(request_id: str, error_code: int, message: str) -> str:
        """Create JSON-RPC error response."""
        response = {
            "jsonrpc": "2.0",
            "error": {
                "code": error_code,
                "message": message
            },
            "id": request_id
        }
        return json.dumps(response)


class MCPContext:
    """Model Context Protocol for structured context exchange."""
    
    def __init__(self):
        self.context_store: Dict[str, Dict] = {}
        self.context_version: int = 1
    
    def create_context(
        self,
        context_id: str,
        agent_id: int,
        context_type: str,
        data: Dict[str, Any]
    ) -> str:
        """Create a new MCP context."""
        context = {
            "context_id": context_id,
            "agent_id": agent_id,
            "type": context_type,
            "data": data,
            "version": self.context_version,
            "created_at": time.time(),
            "expires_at": time.time() + 60  # 60 second TTL
        }
        self.context_store[context_id] = context
        self.context_version += 1
        return context_id
    
    def get_context(self, context_id: str) -> Optional[Dict]:
        """Retrieve MCP context."""
        context = self.context_store.get(context_id)
        if context and time.time() < context["expires_at"]:
            return context
        elif context:
            del self.context_store[context_id]
        return None
    
    def update_context(self, context_id: str, updates: Dict[str, Any]) -> bool:
        """Update existing MCP context."""
        context = self.get_context(context_id)
        if context:
            context["data"].update(updates)
            context["version"] += 1
            return True
        return False
    
    def cleanup_expired(self):
        """Clean up expired contexts."""
        now = time.time()
        expired = [
            cid for cid, ctx in self.context_store.items()
            if now >= ctx["expires_at"]
        ]
        for cid in expired:
            del self.context_store[cid]


# ── Swarm-MCP: Custom Shared Latent Space Protocol ────────────────────────────────

@dataclass
class EnvironmentalDelta:
    """Vector map of current entropy for Oracle Resource."""
    zone_id: int
    entropy_vector: List[float]  # 30-dimensional vector for all zones
    bottleneck_state: str  # "low_risk", "medium_risk", "high_risk", "critical"
    player_flow: List[float]  # Flow probability to adjacent zones
    timestamp: float


@dataclass
class AtomicCommand:
    """Binary-packed atomic command for zero-desync coordination."""
    command_byte: int  # 1-byte flag
    target_agent_ids: List[int]
    parameters: Dict[str, Any]
    tick: int


@dataclass
class AttentionEntry:
    """Entry in Shared Attention Buffer (Blackboard)."""
    agent_id: int
    zone_id: int
    event_type: str  # "deception_success", "player_sighting", "trap_failed"
    confidence: float
    timestamp: float
    ttl: int  # Time-to-live in ticks


class SharedAttentionBuffer:
    """Shared Attention Buffer (Blackboard) for cross-agent awareness."""
    
    def __init__(self, max_entries: int = 100):
        self.buffer: List[AttentionEntry] = []
        self.max_entries = max_entries
        self.zone_subscriptions: Dict[int, Set[int]] = {}  # zone_id -> agent_ids
        self.agent_subscriptions: Dict[int, Set[int]] = {}  # agent_id -> zone_ids
        self.callbacks: Dict[int, List[Callable]] = {}  # agent_id -> list of callbacks
    
    def register_callback(self, agent_id: int, callback: Callable):
        """Register a callback for an agent to be notified of new entries."""
        if agent_id not in self.callbacks:
            self.callbacks[agent_id] = []
        self.callbacks[agent_id].append(callback)
    
    def unregister_callback(self, agent_id: int, callback: Callable):
        """Unregister a callback for an agent."""
        if agent_id in self.callbacks:
            if callback in self.callbacks[agent_id]:
                self.callbacks[agent_id].remove(callback)
    
    def write(self, entry: AttentionEntry):
        """Write entry to shared buffer and notify subscribers."""
        self.buffer.append(entry)
        
        # Cleanup old entries
        self._cleanup()
        
        # Notify subscribers with callbacks
        if entry.zone_id in self.zone_subscriptions:
            for agent_id in self.zone_subscriptions[entry.zone_id]:
                if agent_id in self.callbacks:
                    for callback in self.callbacks[agent_id]:
                        try:
                            callback(entry)
                        except Exception as e:
                            # Silently handle callback errors to prevent cascade failures
                            pass
    
    def read(self, agent_id: int, zone_id: Optional[int] = None) -> List[AttentionEntry]:
        """Read entries relevant to agent."""
        relevant = []
        
        for entry in self.buffer:
            # Agent-specific reads
            if zone_id is not None:
                if entry.zone_id == zone_id:
                    relevant.append(entry)
            else:
                # Read all entries for subscribed zones
                if agent_id in self.agent_subscriptions:
                    if entry.zone_id in self.agent_subscriptions[agent_id]:
                        relevant.append(entry)
        
        return relevant
    
    def subscribe(self, agent_id: int, zone_id: int, callback: Optional[Callable] = None):
        """Agent subscribes to zone updates with optional callback."""
        if zone_id not in self.zone_subscriptions:
            self.zone_subscriptions[zone_id] = set()
        self.zone_subscriptions[zone_id].add(agent_id)
        
        if agent_id not in self.agent_subscriptions:
            self.agent_subscriptions[agent_id] = set()
        self.agent_subscriptions[agent_id].add(zone_id)
        
        # Register callback if provided
        if callback is not None:
            self.register_callback(agent_id, callback)
    
    def unsubscribe(self, agent_id: int, zone_id: int):
        """Agent unsubscribes from zone updates."""
        if zone_id in self.zone_subscriptions:
            self.zone_subscriptions[zone_id].discard(agent_id)
        if agent_id in self.agent_subscriptions:
            self.agent_subscriptions[agent_id].discard(zone_id)
    
    def _cleanup(self):
        """Remove expired entries."""
        now = time.time()
        self.buffer = [
            e for e in self.buffer
            if now - e.timestamp < e.ttl / 60.0  # Convert ticks to seconds
        ]
        
        # Trim to max entries
        if len(self.buffer) > self.max_entries:
            self.buffer = self.buffer[-self.max_entries:]


class BinaryProtocol:
    """Binary-Packed Protocol for atomic commands."""
    
    # Command byte flags (1-byte = 256 possible commands)
    COMMANDS = {
        0x00: "WAIT",
        0x01: "MOVE_NORTH",
        0x02: "MOVE_SOUTH",
        0x03: "MOVE_EAST",
        0x04: "MOVE_WEST",
        0x05: "INITIATE_PINCER",
        0x06: "ABORT_PINCER",
        0x07: "GASLIGHT_ZONE",
        0x08: "GHOST_AMBUSH",
        0x09: "ARCHITECT_BLOCK",
        0x0A: "HOUND_CHASE",
        0x0B: "CONDUCTOR_SYNC",
        0xFF: "EMERGENCY_STOP"
    }
    
    @staticmethod
    def encode_command(command_name: str, target_agents: List[int], params: Dict = None) -> AtomicCommand:
        """Encode command to binary format."""
        # Find command byte
        command_byte = None
        for byte, name in BinaryProtocol.COMMANDS.items():
            if name == command_name:
                command_byte = byte
                break
        
        if command_byte is None:
            command_byte = 0x00  # Default to WAIT
        
        return AtomicCommand(
            command_byte=command_byte,
            target_agent_ids=target_agents,
            parameters=params or {},
            tick=int(time.time() * 60)  # Convert to ticks
        )
    
    @staticmethod
    def decode_command(command_byte: int) -> str:
        """Decode command byte to name."""
        return BinaryProtocol.COMMANDS.get(command_byte, "UNKNOWN")
    
    @staticmethod
    def pack_atomic_commands(commands: List[AtomicCommand]) -> bytes:
        """Pack multiple atomic commands into single byte stream."""
        packed = bytearray()
        for cmd in commands:
            packed.append(cmd.command_byte)
            # Pack target agent count and IDs
            packed.append(len(cmd.target_agent_ids))
            for agent_id in cmd.target_agent_ids:
                packed.append(agent_id & 0xFF)  # 1 byte per agent ID
        return bytes(packed)
    
    @staticmethod
    def unpack_atomic_commands(data: bytes) -> List[AtomicCommand]:
        """Unpack byte stream into atomic commands."""
        commands = []
        offset = 0
        
        while offset < len(data):
            command_byte = data[offset]
            offset += 1
            
            target_count = data[offset]
            offset += 1
            
            target_agents = []
            for _ in range(target_count):
                if offset < len(data):
                    target_agents.append(data[offset])
                    offset += 1
            
            commands.append(AtomicCommand(
                command_byte=command_byte,
                target_agent_ids=target_agents,
                parameters={},
                tick=int(time.time() * 60)
            ))
        
        return commands


class OracleResource:
    """Oracle Resource for Context Injection - provides vector entropy maps."""
    
    # Zone adjacency map - which zones connect to which
    ZONE_ADJACENCY = {
        0: [1, 9],          # Entrance Hall -> Corridors, Attic
        1: [0, 2, 10],       # Corridors -> Entrance Hall, Ballroom, Basement
        2: [1, 3, 19],       # Ballroom Antechamber -> Corridors, Dining, Ballroom
        3: [2, 4],           # Dining Room -> Ballroom Antechamber, Kitchen
        4: [3, 5],           # Kitchen -> Dining Room, Pantry
        5: [4, 6],           # Pantry -> Kitchen, Wine Cellar
        6: [5, 14],          # Wine Cellar Stairs -> Pantry, Wine Cellar
        7: [8, 15],          # Old Morgue Hall -> Old Morgue, Catacombs
        8: [7, 9],           # Attic Stairs -> Old Morgue Hall, Attic
        9: [0, 8, 10],       # Attic -> Entrance Hall, Attic Stairs, Basement Stairs
        10: [1, 9, 11],      # Basement -> Corridors, Attic, Basement Hall
        11: [10, 12, 21],    # Basement Hall -> Basement, Storage, Catacombs Stairs
        12: [11, 13],        # Storage -> Basement Hall, Laundry
        13: [12, 14],        # Laundry -> Storage, Wine Cellar
        14: [6, 13, 15],     # Wine Cellar -> Wine Cellar Stairs, Laundry, Old Morgue
        15: [7, 14, 16],     # Old Morgue -> Old Morgue Hall, Wine Cellar, Nursery Hall
        16: [15, 17, 18],    # Nursery Hall -> Old Morgue, Nursery Stairs, Nursery
        17: [16, 18],        # Nursery Stairs -> Nursery Hall, Nursery
        18: [16, 17, 19],    # Nursery -> Nursery Hall, Nursery Stairs, Ballroom
        19: [2, 18, 20],     # Ballroom -> Ballroom Antechamber, Nursery, Hall of Mirrors Hall
        20: [19, 21, 26],    # Hall of Mirrors Hall -> Ballroom, Catacombs Stairs, Hall of Mirrors
        21: [11, 20, 22],    # Catacombs Stairs -> Basement Hall, Hall of Mirrors Hall, Catacombs
        22: [21, 23, 24],    # Catacombs -> Catacombs Stairs, Crypt, Catacombs Deep
        23: [22, 24],        # Crypt -> Catacombs, Catacombs Deep
        24: [22, 23, 25],    # Catacombs Deep -> Catacombs, Crypt, Research Chamber Hall
        25: [24, 26, 28],    # Research Chamber Hall -> Catacombs Deep, Hall of Mirrors, Research Chamber
        26: [20, 25, 27],    # Hall of Mirrors -> Hall of Mirrors Hall, Research Chamber Hall, Mirror Maze
        27: [26, 28],        # Mirror Maze -> Hall of Mirrors, Research Chamber
        28: [25, 27, 29],    # Research Chamber -> Research Chamber Hall, Mirror Maze, The Void
        29: [28]             # The Void -> Research Chamber
    }
    
    def __init__(self, config: StalkerConfig):
        self.config = config
        self.zone_entropy_cache: Dict[int, EnvironmentalDelta] = {}
        self.last_update: float = 0
        self.update_interval: float = 0.5  # Update every 0.5 seconds
    
    def get_environmental_delta(
        self, 
        current_zone: int,
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> EnvironmentalDelta:
        """Get vector map of current entropy for a zone."""
        now = time.time()
        
        # Check cache
        if current_zone in self.zone_entropy_cache:
            cached = self.zone_entropy_cache[current_zone]
            if now - cached.timestamp < self.update_interval:
                return cached
        
        # Calculate entropy vector (30-dimensional for all zones)
        entropy_vector = self._calculate_entropy_vector(
            current_zone,
            player_position,
            agent_positions
        )
        
        # Determine bottleneck state
        bottleneck_state = self._classify_bottleneck(entropy_vector[current_zone])
        
        # Calculate player flow probabilities
        player_flow = self._calculate_player_flow(current_zone, player_position)
        
        delta = EnvironmentalDelta(
            zone_id=current_zone,
            entropy_vector=entropy_vector,
            bottleneck_state=bottleneck_state,
            player_flow=player_flow,
            timestamp=now
        )
        
        self.zone_entropy_cache[current_zone] = delta
        return delta
    
    def _calculate_entropy_vector(
        self,
        current_zone: int,
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> List[float]:
        """Calculate 30-dimensional entropy vector."""
        entropy = [0.0] * 30
        
        # Base entropy from zone type
        zone_entropy = {
            0: 0.3,   # Entrance Hall
            1: 0.5,   # Corridors
            9: 0.7,   # Attic
            10: 0.4,  # Basement
            14: 0.6,  # Wine Cellar
            18: 0.8,  # Nursery
            19: 0.5,  # Ballroom
            21: 0.9,  # Catacombs
            26: 0.95, # Hall of Mirrors
            28: 1.0,  # Research Chamber
            29: 0.2   # The Void
        }
        
        for zone_id, base in zone_entropy.items():
            entropy[zone_id] = base
        
        # Add agent proximity entropy
        for agent_id, agent_pos in agent_positions.items():
            for zone_id, zone in ZONES.items():
                dist = math.sqrt((agent_pos[0] - zone.x)**2 + (agent_pos[1] - zone.y)**2)
                if dist < 5:
                    entropy[zone_id] += 0.3
        
        # Add player entropy
        for zone_id, zone in ZONES.items():
            dist = math.sqrt((player_position[0] - zone.x)**2 + (player_position[1] - zone.y)**2)
            if dist < 3:
                entropy[zone_id] += 0.5
        
        # Normalize to 0-1
        entropy = [min(1.0, max(0.0, e)) for e in entropy]
        
        return entropy
    
    def _classify_bottleneck(self, entropy: float) -> str:
        """Classify bottleneck state from entropy value."""
        if entropy < 0.3:
            return "low_risk"
        elif entropy < 0.6:
            return "medium_risk"
        elif entropy < 0.9:
            return "high_risk"
        else:
            return "critical"
    
    def _calculate_player_flow(self, current_zone: int, player_position: Tuple[int, int]) -> List[float]:
        """Calculate flow probability to adjacent zones based on connectivity."""
        adjacent_zones = self.ZONE_ADJACENCY.get(current_zone, [])
        
        if not adjacent_zones:
            return [0.0]
        
        # Calculate flow probability based on zone entropy (lower entropy = higher flow)
        flow_probabilities = []
        total_entropy = 0.0
        
        for zone_id in adjacent_zones:
            # Get base entropy for adjacent zone
            zone_entropy = 0.5  # Default
            if zone_id in self.zone_entropy_cache:
                zone_entropy = self.zone_entropy_cache[zone_id].entropy_vector[zone_id]
            
            # Inverse relationship: lower entropy = higher flow probability
            flow_prob = 1.0 - zone_entropy
            flow_probabilities.append(flow_prob)
            total_entropy += flow_prob
        
        # Normalize probabilities
        if total_entropy > 0:
            flow_probabilities = [p / total_entropy for p in flow_probabilities]
        else:
            flow_probabilities = [1.0 / len(flow_probabilities)] * len(flow_probabilities)
        
        return flow_probabilities


class SwarmMCP:
    """
    2026 High-Speed Custom Swarm-MCP with Event-Driven Architecture.
    
    Optimizations for Real-Time Game Swarm:
    1. Event-Driven State Push (SSE-style) - Eliminates polling latency
    2. MCP + A2A Hybrid Logic - SharedBlackboard for agent coordination
    3. Protocol-Level QMIX Monotonicity - Joint reward mixing at MCP level
    4. Metadata Caching - Tool schema and selective context filtering
    5. Batching & Pipelining - State packet grouping for efficiency
    6. Circuit Breakers - Prevent swarm loops on glitches
    
    Resources:
    1. Oracle Resource - Context Injection via getEnvironmentalDelta
    2. Binary-Packed Protocol - Atomic Commands for zero-desync
    3. Shared Attention Buffer - Zone-based environmental events (existing)
    4. Subscription Model - Zone heatmap change detection
    5. SharedBlackboard - Key-value A2A communication (new)
    6. StatePacket Batcher - Grouped state updates
    
    Dual Blackboard Architecture:
    - SharedAttentionBuffer: Zone-based events (player_sighting, trap_failed, etc.)
    - SharedBlackboard: Key-value A2A communication (visual_lock, task_delegation, etc.)
    """
    
    def __init__(self, config: StalkerConfig, num_agents: int = 5):
        self.config = config
        self.num_agents = num_agents
        
        # Resources
        self.oracle = OracleResource(config)
        self.binary_protocol = BinaryProtocol()
        self.attention_buffer = SharedAttentionBuffer()
        
        # Subscription Model
        self.zone_heatmaps: Dict[int, float] = {}  # zone_id -> heatmap_value
        self.heatmap_subscriptions: Dict[int, Set[int]] = {}  # zone_id -> agent_ids
        self.heatmap_change_threshold: float = 0.1  # 10% change threshold
        
        # Atomic command queue
        self.atomic_command_queue: List[AtomicCommand] = []
        
        # ── 2026 Event-Driven Architecture ─────────────────────────────────────
        # Event-driven state push system (SSE-style)
        self.event_queue: List[Dict] = []
        self.event_subscribers: Dict[int, List[Callable]] = {}  # agent_id -> callbacks
        self.last_event_push: float = 0.0
        self.event_push_interval: float = 0.016  # ~60 FPS state pushes
        
        # MCP + A2A Hybrid: SharedBlackboard for agent-to-agent communication
        self.shared_blackboard: Dict[str, Any] = {}
        self.blackboard_subscriptions: Dict[str, Set[int]] = {}  # key -> agent_ids
        self.blackboard_ttl: Dict[str, float] = {}  # key -> expiry time
        
        # Protocol-Level QMIX Monotonicity
        self.joint_reward_history: List[float] = []
        self.agent_individual_rewards: Dict[int, float] = {}
        self.monotonicity_violations: int = 0
        
        # Metadata Caching
        self.tool_schema_cache: Dict[str, Dict] = {}
        self.context_filter_cache: Dict[int, Set[int]] = {}  # agent_id -> adjacent zones
        
        # Batching & Pipelining
        self.state_packet_buffer: List[Dict] = []
        self.batch_size: int = 10
        self.pipeline_stages: List[Callable] = []
        
        # Circuit Breakers
        self.circuit_breaker_tripped: bool = False
        self.circuit_breaker_threshold: int = 100  # Max failures before trip
        self.failure_count: int = 0
        self.circuit_breaker_cooldown: float = 5.0  # Seconds
        self.last_circuit_breaker_trip: float = 0.0
        
        # Statistics
        self.stats = {
            "oracle_queries": 0,
            "atomic_commands_sent": 0,
            "attention_writes": 0,
            "attention_reads": 0,
            "heatmap_notifications": 0,
            "event_pushes": 0,
            "blackboard_writes": 0,
            "blackboard_reads": 0,
            "state_packets_batched": 0,
            "circuit_breaker_trips": 0,
            "monotonicity_checks": 0
        }
    
    def get_environmental_delta(
        self,
        agent_id: int,
        current_zone: int,
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> EnvironmentalDelta:
        """Oracle Resource: Get vector entropy map."""
        self.stats["oracle_queries"] += 1
        return self.oracle.get_environmental_delta(current_zone, player_position, agent_positions)
    
    def issue_atomic_command(
        self,
        command_name: str,
        target_agent_ids: List[int],
        params: Dict = None
    ) -> str:
        """Issue atomic command using binary protocol."""
        command = self.binary_protocol.encode_command(command_name, target_agent_ids, params)
        self.atomic_command_queue.append(command)
        self.stats["atomic_commands_sent"] += 1
        return f"cmd_{command.command_byte:x}"
    
    def get_atomic_commands(self) -> List[AtomicCommand]:
        """Get pending atomic commands."""
        commands = self.atomic_command_queue.copy()
        self.atomic_command_queue.clear()
        return commands
    
    def pack_and_broadcast_commands(self) -> bytes:
        """Pack all pending commands into byte stream for broadcast."""
        commands = self.get_atomic_commands()
        return self.binary_protocol.pack_atomic_commands(commands)
    
    def write_attention(
        self,
        agent_id: int,
        zone_id: int,
        event_type: str,
        confidence: float,
        ttl: int = 60
    ):
        """Write to Shared Attention Buffer."""
        entry = AttentionEntry(
            agent_id=agent_id,
            zone_id=zone_id,
            event_type=event_type,
            confidence=confidence,
            timestamp=time.time(),
            ttl=ttl
        )
        self.attention_buffer.write(entry)
        self.stats["attention_writes"] += 1
    
    def read_attention(
        self,
        agent_id: int,
        zone_id: Optional[int] = None
    ) -> List[AttentionEntry]:
        """Read from Shared Attention Buffer."""
        entries = self.attention_buffer.read(agent_id, zone_id)
        self.stats["attention_reads"] += len(entries)
        return entries
    
    def subscribe_heatmap(self, agent_id: int, zone_id: int):
        """Subscribe to zone heatmap changes (>10% threshold)."""
        if zone_id not in self.heatmap_subscriptions:
            self.heatmap_subscriptions[zone_id] = set()
        self.heatmap_subscriptions[zone_id].add(agent_id)
        
        # Also subscribe to attention buffer
        self.attention_buffer.subscribe(agent_id, zone_id)
    
    def unsubscribe_heatmap(self, agent_id: int, zone_id: int):
        """Unsubscribe from zone heatmap changes."""
        if zone_id in self.heatmap_subscriptions:
            self.heatmap_subscriptions[zone_id].discard(agent_id)
        
        self.attention_buffer.unsubscribe(agent_id, zone_id)
    
    def update_heatmap(self, zone_id: int, new_value: float) -> List[int]:
        """Update zone heatmap and notify subscribers if change > 10%."""
        old_value = self.zone_heatmaps.get(zone_id, 0.0)
        self.zone_heatmaps[zone_id] = new_value
        
        # Check if change exceeds threshold
        if abs(new_value - old_value) > self.heatmap_change_threshold:
            notified_agents = []
            if zone_id in self.heatmap_subscriptions:
                notified_agents = list(self.heatmap_subscriptions[zone_id])
                self.stats["heatmap_notifications"] += len(notified_agents)
            return notified_agents
        
        return []
    
    def poll_swarm_intent(self, agent_id: int) -> Dict:
        """Poll swarm intent for console integration."""
        # Get relevant attention entries
        attention_entries = self.read_attention(agent_id)
        
        # Get pending atomic commands for this agent
        pending_commands = [
            cmd for cmd in self.atomic_command_queue
            if agent_id in cmd.target_agent_ids
        ]
        
        return {
            "agent_id": agent_id,
            "attention_entries": [
                {
                    "zone_id": e.zone_id,
                    "event_type": e.event_type,
                    "confidence": e.confidence
                }
                for e in attention_entries
            ],
            "pending_commands": [
                {
                    "command": self.binary_protocol.decode_command(cmd.command_byte),
                    "parameters": cmd.parameters
                }
                for cmd in pending_commands
            ],
            "timestamp": time.time()
        }
    
    def get_statistics(self) -> Dict:
        """Get MCP statistics."""
        return self.stats.copy()
    
    # ── 2026 Event-Driven State Push Methods ─────────────────────────────────────
    
    def push_state_event(
        self,
        event_type: str,
        data: Dict,
        target_agent_ids: List[int] = None
    ) -> None:
        """
        Push state event to subscribed agents (SSE-style).
        Eliminates polling latency by pushing changes immediately.
        """
        if self.circuit_breaker_tripped:
            return
        
        event = {
            "event_type": event_type,
            "data": data,
            "timestamp": time.time(),
            "target_agent_ids": target_agent_ids  # None = broadcast to all
        }
        
        self.event_queue.append(event)
        self.stats["event_pushes"] += 1
    
    def subscribe_to_events(self, agent_id: int, callback: Callable) -> None:
        """Subscribe an agent to event-driven state pushes."""
        if agent_id not in self.event_subscribers:
            self.event_subscribers[agent_id] = []
        self.event_subscribers[agent_id].append(callback)
    
    def process_event_queue(self) -> None:
        """
        Process queued events and push to subscribers.
        Called every frame to maintain ~60 FPS state synchronization.
        """
        now = time.time()
        if now - self.last_event_push < self.event_push_interval:
            return
        
        self.last_event_push = now
        
        for event in self.event_queue[:]:
            target_ids = event.get("target_agent_ids")
            
            if target_ids is None:
                # Broadcast to all subscribers
                for agent_id, callbacks in self.event_subscribers.items():
                    for callback in callbacks:
                        try:
                            callback(event)
                        except Exception:
                            self._record_failure()
            else:
                # Push to specific agents
                for agent_id in target_ids:
                    if agent_id in self.event_subscribers:
                        for callback in self.event_subscribers[agent_id]:
                            try:
                                callback(event)
                            except Exception:
                                self._record_failure()
            
            self.event_queue.remove(event)
    
    # ── MCP + A2A Hybrid: SharedBlackboard Methods ───────────────────────────────
    # Note: SharedBlackboard complements SharedAttentionBuffer
    # - SharedAttentionBuffer: Zone-based environmental events (existing)
    # - SharedBlackboard: Key-value A2A communication (new)
    
    def blackboard_write(
        self,
        key: str,
        value: Any,
        ttl: float = 5.0,
        writer_agent_id: int = None
    ) -> None:
        """
        Write to SharedBlackboard for A2A agent-to-agent communication.
        Enables direct Stalker-to-Stalker task delegation.
        
        Complements SharedAttentionBuffer which handles zone-based events.
        """
        if self.circuit_breaker_tripped:
            return
        
        self.shared_blackboard[key] = {
            "value": value,
            "writer_agent_id": writer_agent_id,
            "timestamp": time.time()
        }
        self.blackboard_ttl[key] = time.time() + ttl
        self.stats["blackboard_writes"] += 1
        
        # Notify subscribers
        if key in self.blackboard_subscriptions:
            for agent_id in self.blackboard_subscriptions[key]:
                self.push_state_event(
                    event_type="blackboard_update",
                    data={"key": key, "value": value},
                    target_agent_ids=[agent_id]
                )
    
    def blackboard_read(self, key: str, reader_agent_id: int = None) -> Optional[Any]:
        """Read from SharedBlackboard."""
        # Check TTL
        if key in self.blackboard_ttl and time.time() > self.blackboard_ttl[key]:
            del self.shared_blackboard[key]
            del self.blackboard_ttl[key]
            return None
        
        if key in self.shared_blackboard:
            self.stats["blackboard_reads"] += 1
            return self.shared_blackboard[key]["value"]
        return None
    
    def subscribe_blackboard(self, agent_id: int, key: str) -> None:
        """Subscribe an agent to blackboard key updates."""
        if key not in self.blackboard_subscriptions:
            self.blackboard_subscriptions[key] = set()
        self.blackboard_subscriptions[key].add(agent_id)
    
    def get_visual_lock(self) -> Optional[Dict]:
        """
        Get current visual lock from blackboard.
        When Hound sees player, it writes "Visual Lock" here.
        Conductor reads this to delegate tasks via A2A.
        """
        return self.blackboard_read("visual_lock")
    
    def set_visual_lock(
        self,
        player_position: Tuple[int, int],
        confidence: float,
        agent_id: int,
        zone_id: int = None
    ) -> None:
        """
        Set visual lock when agent spots player.
        Writes to both SharedBlackboard (A2A) and SharedAttentionBuffer (zone events).
        """
        # Write to SharedBlackboard for A2A communication
        self.blackboard_write(
            key="visual_lock",
            value={
                "player_position": player_position,
                "confidence": confidence,
                "spotter_agent_id": agent_id
            },
            ttl=2.0,  # 2 second visual lock
            writer_agent_id=agent_id
        )
        
        # Also write to SharedAttentionBuffer for zone-based awareness
        if zone_id is not None:
            entry = AttentionEntry(
                agent_id=agent_id,
                zone_id=zone_id,
                event_type="player_sighting",
                confidence=confidence,
                timestamp=time.time(),
                ttl=120  # 2 seconds in ticks
            )
            self.attention_buffer.write(entry)
    
    # ── Protocol-Level QMIX Monotonicity Methods ───────────────────────────────────
    
    def calculate_mcp_joint_reward(
        self,
        agent_ids: List[int],
        individual_rewards: Dict[int, float],
        goal_progress: float
    ) -> Dict[str, Any]:
        """
        Calculate joint reward at MCP level (QMIX monotonicity).
        MCP acts as the "Joint Reward Mixer" and streams gradient updates.
        """
        if self.circuit_breaker_tripped:
            return {"joint_reward": 0.0, "monotonicity_satisfied": False}
        
        # Record individual rewards
        for agent_id, reward in individual_rewards.items():
            self.agent_individual_rewards[agent_id] = reward
        
        # Weight individual rewards (20%)
        weighted_individual = sum(
            self.agent_individual_rewards.get(aid, 0.0) * 0.2
            for aid in agent_ids
        )
        
        # Weight joint goal progress (80%)
        weighted_joint = goal_progress * 0.8
        
        # Mix rewards
        joint_reward = weighted_individual + weighted_joint
        
        # Check monotonicity
        monotonicity_satisfied = self._check_mcp_monotonicity(
            agent_ids, joint_reward
        )
        
        self.joint_reward_history.append(joint_reward)
        self.stats["monotonicity_checks"] += 1
        
        # Push reward update to agents
        self.push_state_event(
            event_type="joint_reward_update",
            data={
                "joint_reward": joint_reward,
                "monotonicity_satisfied": monotonicity_satisfied
            },
            target_agent_ids=agent_ids
        )
        
        return {
            "joint_reward": joint_reward,
            "monotonicity_satisfied": monotonicity_satisfied,
            "individual_rewards": individual_rewards.copy()
        }
    
    def _check_mcp_monotonicity(
        self,
        agent_ids: List[int],
        current_joint: float
    ) -> bool:
        """Check if monotonicity constraint is satisfied at MCP level."""
        if len(self.joint_reward_history) < 2:
            return True
        
        prev_joint = self.joint_reward_history[-2]
        
        # Calculate total individual reward change
        total_individual = sum(
            self.agent_individual_rewards.get(aid, 0.0) for aid in agent_ids
        )
        
        # Get previous total (approximate from history)
        prev_total = total_individual * 0.95  # Assume slight decay
        
        # Monotonicity: if individual increased, joint must increase
        if total_individual >= prev_total:
            if current_joint < prev_joint:
                self.monotonicity_violations += 1
                return False
        
        return True
    
    # ── Metadata Caching and Selective Context Methods ────────────────────────────
    
    def cache_tool_schema(self, tool_name: str, schema: Dict) -> None:
        """Cache tool schema so agents don't rediscover capabilities."""
        self.tool_schema_cache[tool_name] = schema
    
    def get_tool_schema(self, tool_name: str) -> Optional[Dict]:
        """Get cached tool schema."""
        return self.tool_schema_cache.get(tool_name)
    
    def set_adjacent_zones(self, agent_id: int, zones: Set[int]) -> None:
        """
        Set adjacent zones for an agent.
        MCP only feeds data from adjacent zones (selective context).
        """
        self.context_filter_cache[agent_id] = zones
    
    def get_filtered_context(
        self,
        agent_id: int,
        full_context: Dict[int, Any]
    ) -> Dict[int, Any]:
        """
        Filter context to only adjacent zones.
        Ghost in Zone 29 doesn't need Zone 1 data.
        """
        adjacent_zones = self.context_filter_cache.get(agent_id, set())
        
        if not adjacent_zones:
            return full_context  # No filter, return all
        
        filtered = {}
        for zone_id, data in full_context.items():
            if zone_id in adjacent_zones:
                filtered[zone_id] = data
        
        return filtered
    
    # ── Batching & Pipelining Methods ────────────────────────────────────────────
    
    def add_to_state_packet(self, state_update: Dict) -> None:
        """Add state update to batch buffer."""
        self.state_packet_buffer.append(state_update)
        
        # Auto-flush if batch size reached
        if len(self.state_packet_buffer) >= self.batch_size:
            self.flush_state_packet()
    
    def flush_state_packet(self) -> List[Dict]:
        """
        Flush buffered state updates as a single packet.
        Groups multiple game-state updates into one "State Packet".
        """
        if not self.state_packet_buffer:
            return []
        
        packet = self.state_packet_buffer.copy()
        self.state_packet_buffer.clear()
        self.stats["state_packets_batched"] += 1
        
        # Push batched packet to subscribers
        self.push_state_event(
            event_type="state_packet",
            data={"updates": packet},
            target_agent_ids=None  # Broadcast
        )
        
        return packet
    
    def add_pipeline_stage(self, stage: Callable) -> None:
        """Add a processing stage to the pipeline."""
        self.pipeline_stages.append(stage)
    
    def process_pipeline(self, data: Any) -> Any:
        """Process data through all pipeline stages."""
        result = data
        for stage in self.pipeline_stages:
            result = stage(result)
        return result
    
    # ── Circuit Breaker Methods ───────────────────────────────────────────────────
    
    def _record_failure(self) -> None:
        """Record a failure and check circuit breaker."""
        self.failure_count += 1
        
        if self.failure_count >= self.circuit_breaker_threshold:
            self.trip_circuit_breaker()
    
    def trip_circuit_breaker(self) -> None:
        """Trip circuit breaker to prevent swarm loops."""
        self.circuit_breaker_tripped = True
        self.last_circuit_breaker_trip = time.time()
        self.stats["circuit_breaker_trips"] += 1
        
        # Clear queues to prevent cascading failures
        self.event_queue.clear()
        self.state_packet_buffer.clear()
    
    def check_circuit_breaker(self) -> bool:
        """Check if circuit breaker should be reset."""
        if not self.circuit_breaker_tripped:
            return False
        
        # Reset after cooldown
        if time.time() - self.last_circuit_breaker_trip > self.circuit_breaker_cooldown:
            self.reset_circuit_breaker()
            return True
        
        return False
    
    def reset_circuit_breaker(self) -> None:
        """Reset circuit breaker after cooldown."""
        self.circuit_breaker_tripped = False
        self.failure_count = 0
    
    # ── 2026 High-Speed Integration Method ───────────────────────────────────────
    
    def update_mcp_2026(
        self,
        current_tick: int,
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]],
        agent_zones: Dict[int, int]
    ) -> Dict[str, Any]:
        """
        Main 2026 MCP update loop - integrates all optimizations.
        Call this every frame for high-speed swarm coordination.
        """
        # Check circuit breaker
        self.check_circuit_breaker()
        
        if self.circuit_breaker_tripped:
            return {"status": "circuit_breaker_tripped"}
        
        # Process event queue (SSE-style state pushes)
        self.process_event_queue()
        
        # Flush any pending state packets
        self.flush_state_packet()
        
        # Update zone heatmaps with selective context
        for agent_id, zone_id in agent_zones.items():
            adjacent_zones = self.context_filter_cache.get(agent_id, {zone_id})
            for adj_zone in adjacent_zones:
                # Calculate heatmap value based on agent proximity
                agent_pos = agent_positions.get(agent_id, (0, 0))
                zone_center = self._get_zone_center(adj_zone)
                distance = math.sqrt(
                    (agent_pos[0] - zone_center[0])**2 +
                    (agent_pos[1] - zone_center[1])**2
                )
                heatmap_value = max(0.0, 1.0 - distance / 10.0)
                
                notified = self.update_heatmap(adj_zone, heatmap_value)
                if notified:
                    # Push heatmap update to subscribed agents
                    self.push_state_event(
                        event_type="heatmap_update",
                        data={"zone_id": adj_zone, "value": heatmap_value},
                        target_agent_ids=notified
                    )
        
        # Cleanup expired blackboard entries
        self._cleanup_blackboard()
        
        return {
            "status": "active",
            "event_queue_size": len(self.event_queue),
            "blackboard_entries": len(self.shared_blackboard),
            "circuit_breaker_active": self.circuit_breaker_tripped
        }
    
    def _get_zone_center(self, zone_id: int) -> Tuple[int, int]:
        """Get center position of a zone."""
        # Simplified: use ZONES dict if available
        if zone_id in ZONES:
            return (ZONES[zone_id].x, ZONES[zone_id].y)
        # For zones not in ZONES dict, estimate based on zone_id
        return (10 + zone_id, 5)  # Simple linear fallback
    
    def _cleanup_blackboard(self) -> None:
        """Remove expired blackboard entries."""
        now = time.time()
        expired_keys = [
            key for key, expiry in self.blackboard_ttl.items()
            if now >= expiry
        ]
        for key in expired_keys:
            del self.shared_blackboard[key]
            del self.blackboard_ttl[key]


class VIL2CCommNet:
    """
    VoI-Aware Low-latency Communication (VIL2C) - 2026 Gold Standard.
    
    Features:
    - Value-of-Information ranking for message prioritization
    - Progressive reception for sub-millisecond decision making
    - A2A Protocol (JSON-RPC style) for agent coordination
    - MCP Integration for structured context exchange
    - Network Slicing for mission-critical traffic isolation
    - Distributed Edge Topology for minimal latency
    """
    
    def __init__(self, config: StalkerConfig, num_agents: int = 5):
        self.config = config
        self.num_agents = num_agents
        self.belief_states: Dict[int, BeliefState] = {i: BeliefState() for i in range(num_agents)}
        self.shared_belief = BeliefState()
        
        # VIL2C components
        self.message_queue: List[VoIMessage] = []  # Priority queue
        self.voi_calculator = VoICalculator(config)
        self.progressive_receiver = ProgressiveReceiver()
        
        # A2A and MCP
        self.a2a_protocol = A2AProtocol()
        self.mcp = MCPContext()
        self.request_counter: int = 0
        
        # Network Slicing
        self.network_slices: Dict[str, NetworkSlice] = {
            "critical": NetworkSlice("critical", config.CRITICAL_BANDWIDTH_ALLOCATION, 1),
            "normal": NetworkSlice("normal", 1.0 - config.CRITICAL_BANDWIDTH_ALLOCATION, 2),
            "background": NetworkSlice("background", 0.2, 3)
        }
        
        # Distributed Edge
        self.edge_nodes: Dict[int, str] = {}  # agent_id -> edge_location
        self.conductor_edge = "central"  # Conductor at central edge
        
        # Statistics
        self.stats = {
            "messages_sent": 0,
            "messages_received": 0,
            "high_voi_messages": 0,
            "progressive_early_stop": 0,
            "network_slice_critical": 0
        }
    
    def calculate_voi(self, message_type: str, payload: Dict, sender_role: str) -> float:
        """Calculate Value-of-Information score for a message."""
        return self.voi_calculator.calculate(message_type, payload, sender_role)
    
    def broadcast_belief(
        self, 
        agent_id: int, 
        belief: BeliefState, 
        current_tick: int,
        sender_role: str = "unknown"
    ) -> str:
        """Broadcast belief with VoI ranking."""
        self.request_counter += 1
        message_id = f"msg_{self.request_counter}_{int(time.time() * 1000)}"
        
        # Determine message type and calculate VoI
        if belief.confidence > 0.9 and belief.player_position:
            message_type = "player_sighting"
        elif belief.confidence > 0.5:
            message_type = "coordination"
        else:
            message_type = "heartbeat"
        
        voi_score = self.calculate_voi(message_type, {
            "player_position": belief.player_position,
            "confidence": belief.confidence
        }, sender_role)
        
        # Create VoI message
        message = VoIMessage(
            message_id=message_id,
            sender_id=agent_id,
            receiver_id=None,  # Broadcast
            voi_score=voi_score,
            message_type=message_type,
            payload={
                "player_position": belief.player_position,
                "confidence": belief.confidence,
                "zone_activity": belief.zone_activity,
                "metadata": belief.metadata
            },
            timestamp=time.time(),
            tick=current_tick
        )
        
        # Compress and chunk for progressive reception
        if self.config.VIL2C_ENABLED:
            message.progressive_chunks = self._create_progressive_chunks(message)
            message.compressed = True
        
        # Route to appropriate network slice
        slice_name = self._route_to_slice(message)
        self.network_slices[slice_name].message_queue.append(message)
        
        # Update statistics
        self.stats["messages_sent"] += 1
        if voi_score > self.config.VIL2C_HIGH_VOI_THRESHOLD:
            self.stats["high_voi_messages"] += 1
        if slice_name == "critical":
            self.stats["network_slice_critical"] += 1
        
        # Update shared belief for high VoI messages
        if belief.confidence > self.config.COMMNET_CONFIDENCE_THRESHOLD:
            self._update_shared_belief(belief, current_tick)
        
        return message_id
    
    def receive_belief(
        self, 
        agent_id: int, 
        current_tick: int,
        required_confidence: float = 0.5
    ) -> BeliefState:
        """Receive belief with progressive reception."""
        received_beliefs = []
        
        # Process messages from all slices in priority order
        for slice_name in ["critical", "normal", "background"]:
            slice_queue = self.network_slices[slice_name].message_queue
            
            # Filter relevant messages
            relevant = [
                m for m in slice_queue
                if m.sender_id != agent_id and
                current_tick - m.tick >= self.config.COMMNET_LATENCY_TICKS
            ]
            
            for message in relevant:
                # Progressive reception: stop early if we have enough info
                if self.config.VIL2C_ENABLED:
                    received = self.progressive_receiver.receive(
                        message,
                        required_confidence
                    )
                    if received["early_stop"]:
                        self.stats["progressive_early_stop"] += 1
                        received_beliefs.append(message)
                        break  # Stop processing this slice
                    elif received["complete"]:
                        received_beliefs.append(message)
                else:
                    received_beliefs.append(message)
        
        # Aggregate beliefs
        if received_beliefs:
            aggregated = self._aggregate_beliefs_voi(received_beliefs)
            self.belief_states[agent_id] = aggregated
        
        # Decay belief
        self._decay_belief(self.belief_states[agent_id])
        
        # Update statistics
        self.stats["messages_received"] += len(received_beliefs)
        
        # Cleanup processed messages
        self._cleanup_processed_messages(agent_id, current_tick)
        
        return self.belief_states[agent_id]
    
    def send_a2a_request(
        self,
        sender_id: int,
        receiver_id: int,
        method: str,
        params: Dict[str, Any]
    ) -> str:
        """Send A2A protocol request."""
        request_id = f"a2a_{self.request_counter}_{int(time.time() * 1000)}"
        request_json = self.a2a_protocol.create_request(
            method, params, request_id, sender_id
        )
        
        # Create MCP context for the request
        context_id = f"ctx_{request_id}"
        self.mcp.create_context(
            context_id,
            sender_id,
            "a2a_request",
            {
                "request": request_json,
                "receiver_id": receiver_id,
                "status": "pending"
            }
        )
        
        self.request_counter += 1
        return request_id
    
    def receive_a2a_request(self, context_id: str) -> Optional[Dict]:
        """Receive and parse A2A request."""
        context = self.mcp.get_context(context_id)
        if context:
            request_json = context["data"]["request"]
            return self.a2a_protocol.parse_response(request_json)
        return None
    
    def _create_progressive_chunks(self, message: VoIMessage) -> List[Dict]:
        """Create progressive chunks for a message."""
        chunks = []
        payload = message.payload
        
        # Chunk 1: Most critical info (position + high confidence)
        chunks.append({
            "chunk_id": 0,
            "priority": "critical",
            "data": {
                "player_position": payload.get("player_position"),
                "confidence": payload.get("confidence")
            }
        })
        
        # Chunk 2: Zone activity
        chunks.append({
            "chunk_id": 1,
            "priority": "high",
            "data": {
                "zone_activity": payload.get("zone_activity", {})
            }
        })
        
        # Chunk 3: Metadata
        chunks.append({
            "chunk_id": 2,
            "priority": "normal",
            "data": {
                "metadata": payload.get("metadata", {})
            }
        })
        
        return chunks
    
    def _route_to_slice(self, message: VoIMessage) -> str:
        """Route message to appropriate network slice."""
        if message.voi_score > self.config.VIL2C_HIGH_VOI_THRESHOLD:
            return "critical"
        elif message.voi_score > self.config.VIL2C_LOW_VOI_THRESHOLD:
            return "normal"
        else:
            return "background"
    
    def _update_shared_belief(self, new_belief: BeliefState, current_tick: int):
        """Update shared belief with new information."""
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
        
        for zone_id, activity in new_belief.zone_activity.items():
            self.shared_belief.zone_activity[zone_id] = max(
                self.shared_belief.zone_activity.get(zone_id, 0),
                activity
            )
    
    def _aggregate_beliefs_voi(self, messages: List[VoIMessage]) -> BeliefState:
        """Aggregate beliefs using VoI-weighted averaging."""
        if not messages:
            return BeliefState()
        
        # Sort by VoI score
        messages_sorted = sorted(messages, key=lambda m: m.voi_score, reverse=True)
        
        # Weight by VoI score
        total_weight = 0
        weighted_x = 0
        weighted_y = 0
        zone_activity = {}
        
        for msg in messages_sorted:
            payload = msg.payload
            weight = msg.voi_score
            total_weight += weight
            
            if payload.get("player_position"):
                weighted_x += weight * payload["player_position"][0]
                weighted_y += weight * payload["player_position"][1]
            
            for zone_id, activity in payload.get("zone_activity", {}).items():
                zone_activity[zone_id] = max(zone_activity.get(zone_id, 0), activity)
        
        aggregated = BeliefState()
        if total_weight > 0:
            aggregated.player_position = (int(weighted_x / total_weight), int(weighted_y / total_weight))
            aggregated.confidence = total_weight / len(messages_sorted)
            aggregated.zone_activity = zone_activity
        
        return aggregated
    
    def _decay_belief(self, belief: BeliefState):
        """Decay belief confidence over time."""
        belief.confidence *= self.config.COMMNET_BELIEF_DECAY
        
        for zone_id in belief.zone_activity:
            belief.zone_activity[zone_id] *= self.config.COMMNET_BELIEF_DECAY
        
        belief.zone_activity = {
            k: v for k, v in belief.zone_activity.items() 
            if v > 0.1
        }
    
    def _cleanup_processed_messages(self, agent_id: int, current_tick: int):
        """Clean up processed messages from queues."""
        for slice_name in self.network_slices:
            self.network_slices[slice_name].message_queue = [
                m for m in self.network_slices[slice_name].message_queue
                if not (m.sender_id != agent_id and current_tick - m.tick >= self.config.COMMNET_LATENCY_TICKS)
            ]
        
        # Cleanup expired MCP contexts
        self.mcp.cleanup_expired()
    
    def coordinate_pincer_maneuver(
        self, 
        agent_positions: Dict[int, Tuple[int, int]],
        player_position: Optional[Tuple[int, int]] = None
    ) -> Dict[int, Tuple[int, int]]:
        """Coordinate pincer maneuver using A2A protocol."""
        positions = list(agent_positions.values())
        
        if player_position is not None:
            target_x, target_y = player_position
        else:
            centroid_x = sum(p[0] for p in positions) / len(positions)
            centroid_y = sum(p[1] for p in positions) / len(positions)
            target_x, target_y = centroid_x, centroid_y
        
        assignments = {}
        sorted_agents = sorted(
            agent_positions.items(),
            key=lambda x: math.sqrt((x[1][0] - target_x)**2 + (x[1][1] - target_y)**2)
        )
        
        if len(sorted_agents) >= 3:
            assignments[sorted_agents[0][0]] = (target_x, target_y)
            flank_distance = 3
            assignments[sorted_agents[1][0]] = (
                max(self.config.MIN_X, target_x - flank_distance),
                target_y
            )
            assignments[sorted_agents[2][0]] = (
                min(self.config.MAX_X, target_x + flank_distance),
                target_y
            )
            for i in range(3, len(sorted_agents)):
                angle = (2 * math.pi * i) / (len(sorted_agents) - 2)
                radius = 4
                assignments[sorted_agents[i][0]] = (
                    int(round(target_x + radius * math.cos(angle))),
                    int(round(target_y + radius * math.sin(angle)))
                )
        else:
            for i, (agent_id, pos) in enumerate(sorted_agents):
                offset_x = 2 if i % 2 == 0 else -2
                offset_y = 2 if i >= 2 else -2
                assignments[agent_id] = (
                    max(self.config.MIN_X, min(self.config.MAX_X, target_x + offset_x)),
                    max(self.config.MIN_Y, min(self.config.MAX_Y, target_y + offset_y))
                )
        
        return assignments
    
    def get_statistics(self) -> Dict:
        """Get communication statistics."""
        return self.stats.copy()


class VoICalculator:
    """Value-of-Information calculator for message prioritization."""
    
    def __init__(self, config: StalkerConfig):
        self.config = config
        self.role_weights = {
            "hound": 1.0,        # Hound sightings are critical
            "architect": 0.9,    # Architect predictions are valuable
            "ghost": 0.7,        # Ghost info is situational
            "gaslighter": 0.5,   # Gaslighter deception is less critical
            "conductor": 1.0,    # Conductor commands are highest priority
            "unknown": 0.5
        }
        self.message_type_weights = {
            "player_sighting": 1.0,
            "coordination": 0.8,
            "deception": 0.6,
            "heartbeat": 0.2
        }
    
    def calculate(self, message_type: str, payload: Dict, sender_role: str) -> float:
        """Calculate VoI score (0.0 to 1.0)."""
        base_score = self.message_type_weights.get(message_type, 0.5)
        role_multiplier = self.role_weights.get(sender_role, 0.5)
        
        # Confidence bonus
        confidence = payload.get("confidence", 0.0)
        confidence_bonus = confidence * 0.3
        
        # Recency bonus (if timestamp available)
        recency_bonus = 0.0
        
        # Calculate final score
        voi_score = (base_score * role_multiplier) + confidence_bonus + recency_bonus
        return min(1.0, max(0.0, voi_score))


class ProgressiveReceiver:
    """Progressive reception for sub-millisecond decision making."""
    
    def __init__(self):
        self.received_chunks: Dict[str, List[Dict]] = {}
    
    def receive(self, message: VoIMessage, required_confidence: float) -> Dict:
        """Receive message progressively."""
        if not message.compressed or not message.progressive_chunks:
            return {"complete": True, "early_stop": False}
        
        message_id = message.message_id
        
        # Initialize chunk tracking
        if message_id not in self.received_chunks:
            self.received_chunks[message_id] = []
        
        # Receive chunks in priority order
        chunks_to_receive = message.progressive_chunks[message.current_chunk:]
        
        for chunk in chunks_to_receive:
            self.received_chunks[message_id].append(chunk)
            message.current_chunk += 1
            
            # Check if we have enough info
            if chunk["priority"] == "critical":
                confidence = chunk["data"].get("confidence", 0.0)
                if confidence >= required_confidence:
                    return {"complete": False, "early_stop": True}
        
        # Check if complete
        if message.current_chunk >= len(message.progressive_chunks):
            del self.received_chunks[message_id]
            return {"complete": True, "early_stop": False}
        
        return {"complete": False, "early_stop": False}


# Backward compatibility alias
CommNet = VIL2CCommNet


# ── Gaslighter: The Sensory Saboteur ───────────────────────────────────────────────

@dataclass
class PhantomSignal:
    """Represents a fake sensory signal generated by the Gaslighter."""
    position: Tuple[int, int]
    signal_type: str  # "footprint", "sound", "visual_flicker"
    intensity: float
    ttl: int
    target_agent_id: Optional[int] = None  # Which agent this is meant to deceive


class Gaslighter:
    """The Gaslighter agent - injects sensory noise to confuse player and AI."""
    
    def __init__(self, config: StalkerConfig, agent_id: int):
        self.config = config
        self.agent_id = agent_id
        self.phantom_signals: List[PhantomSignal] = []
        self.deception_map: Dict[Tuple[int, int], float] = {}  # tile -> noise level
        self.tile_swaps: Dict[Tuple[int, int], int] = {}  # position -> fake tile type
        self.observation_mask_active: bool = False
        self.masked_zone: Optional[int] = None
        self.deception_cooldown: int = 0
        
    def generate_phantom_signal(
        self, 
        real_stalker_positions: List[Tuple[int, int]],
        player_position: Tuple[int, int],
        target_zone: Optional[int] = None
    ) -> PhantomSignal:
        """Generate a fake signal in a room the swarm is NOT in."""
        # Find a position away from real stalkers
        if target_zone is not None and target_zone in ZONES:
            zone = ZONES[target_zone]
            base_x, base_y = zone.x, zone.y
        else:
            # Random position away from real stalkers
            base_x = random.randint(self.config.MIN_X, self.config.MAX_X)
            base_y = random.randint(self.config.MIN_Y, self.config.MAX_Y)
        
        # Ensure position is not near real stalkers
        for _ in range(10):
            offset_x = random.randint(-3, 3)
            offset_y = random.randint(-3, 3)
            phantom_pos = (base_x + offset_x, base_y + offset_y)
            
            too_close = False
            for real_pos in real_stalker_positions:
                dist = math.sqrt((phantom_pos[0] - real_pos[0])**2 + (phantom_pos[1] - real_pos[1])**2)
                if dist < 5:
                    too_close = True
                    break
            
            if not too_close:
                break
        
        signal_type = random.choice(["footprint", "sound", "visual_flicker"])
        intensity = random.uniform(0.5, 1.0)
        ttl = random.randint(30, 60)
        
        return PhantomSignal(phantom_pos, signal_type, intensity, ttl)
    
    def activate_observation_mask(self, zone_id: int, current_tick: int):
        """Activate fog of war in a high-stakes zone."""
        if self.deception_cooldown > 0:
            return
        
        self.observation_mask_active = True
        self.masked_zone = zone_id
        self.deception_cooldown = 120  # 2 seconds cooldown
        
        # Add noise to all tiles in the zone
        if zone_id in ZONES:
            zone = ZONES[zone_id]
            for dx in range(-2, 3):
                for dy in range(-2, 3):
                    tile_pos = (zone.x + dx, zone.y + dy)
                    if (self.config.MIN_X <= tile_pos[0] <= self.config.MAX_X and
                        self.config.MIN_Y <= tile_pos[1] <= self.config.MAX_Y):
                        self.deception_map[tile_pos] = random.uniform(0.3, 0.8)
        else:
            # Fallback for zones not in ZONES dict
            zone_x, zone_y = (10 + zone_id, 5)
            for dx in range(-2, 3):
                for dy in range(-2, 3):
                    tile_pos = (zone_x + dx, zone_y + dy)
                    if (self.config.MIN_X <= tile_pos[0] <= self.config.MAX_X and
                        self.config.MIN_Y <= tile_pos[1] <= self.config.MAX_Y):
                        self.deception_map[tile_pos] = random.uniform(0.3, 0.8)
    
    def swap_tile_metadata(
        self, 
        position: Tuple[int, int], 
        fake_tile_type: int,
        duration: int = 60
    ):
        """Swap tile metadata to create trap-door effect."""
        self.tile_swaps[position] = {
            'fake_type': fake_tile_type,
            'ttl': duration
        }
    
    def get_corrupted_observation(
        self, 
        tile_at_func, 
        x: int, 
        y: int
    ) -> int:
        """Return potentially corrupted tile observation."""
        pos = (x, y)
        
        # Check for tile swap
        if pos in self.tile_swaps:
            swap = self.tile_swaps[pos]
            if swap['ttl'] > 0:
                swap['ttl'] -= 1
                return swap['fake_type']
            else:
                del self.tile_swaps[pos]
        
        # Check for observation mask noise
        if self.observation_mask_active and pos in self.deception_map:
            noise = self.deception_map[pos]
            if random.random() < noise:
                # Return random nearby tile type to confuse
                return random.choice([0, 2, 5, 6, 10])
        
        # Return real tile
        return tile_at_func(x, y)
    
    def update_deception(self, current_tick: int):
        """Update all deception mechanics."""
        # Update phantom signals
        self.phantom_signals = [
            s for s in self.phantom_signals 
            if s.ttl > 0
        ]
        for signal in self.phantom_signals:
            signal.ttl -= 1
        
        # Decay deception map
        for pos in list(self.deception_map.keys()):
            self.deception_map[pos] *= 0.98
            if self.deception_map[pos] < 0.1:
                del self.deception_map[pos]
        
        # Update observation mask
        if self.observation_mask_active:
            self.deception_cooldown -= 1
            if self.deception_cooldown <= 0:
                self.observation_mask_active = False
                self.masked_zone = None
        
        # Update tile swaps
        for pos in list(self.tile_swaps.keys()):
            self.tile_swaps[pos]['ttl'] -= 1
            if self.tile_swaps[pos]['ttl'] <= 0:
                del self.tile_swaps[pos]
    
    def get_deception_heatmap(self) -> Dict[Tuple[int, int], float]:
        """Return current deception intensity map for visualization."""
        heatmap = {}
        for signal in self.phantom_signals:
            heatmap[signal.position] = signal.intensity
        for pos, noise in self.deception_map.items():
            heatmap[pos] = max(heatmap.get(pos, 0), noise)
        return heatmap


# ── Conductor: Hierarchical Meta-RL Orchestrator ─────────────────────────────────

@dataclass
class Option:
    """A semi-Markov decision policy (macro-instruction)."""
    name: str
    duration_ticks: int
    target_agent_ids: List[int]
    parameters: Dict
    start_tick: int
    confidence: float = 1.0


class Conductor:
    """
    The Conductor - Manager-Worker orchestrator for swarm coordination.
    
    Integrates 2026 coordination fixes:
    - Temporal Credit Assignment: High-level goals with delayed reward evaluation
    - SeqComm: Priority Negotiation for First Mover assignment
    - Leader-Following: Dynamic role assignment to reduce coordination cost
    - Goal Partitioning: Sub-policy selection to prevent redundant actions
    - QMIX Monotonicity: Joint reward mixing for team-aligned incentives
    - Conflict Resolution: Asynchronous negotiation for tile/goal conflicts
    """
    
    def __init__(self, config: StalkerConfig, num_agents: int = 5):
        self.config = config
        self.num_agents = num_agents
        self.active_options: List[Option] = []
        self.gmm_components: List[Dict] = []  # Gaussian Mixture Model for policy distribution
        
        # Simple GNN encoder for agent position encoding
        self.global_gnn_encoder = {
            "embedding_dim": 64,
            "num_layers": 2,
            "agent_embeddings": {i: np.random.randn(64) for i in range(num_agents)}
        }
        
        self.traceback_fsm_state: str = "IDLE"
        self.player_entropy: float = 1.0  # Player predictability (0 = predictable, 1 = random)
        self.heatmap_history: List[Dict] = []
        
        # Distributed Edge Topology
        self.edge_location = "central"  # Conductor at central edge for minimal latency
        self.edge_latency: Dict[str, float] = {
            "central": 0.0,      # Conductor itself
            "near": 0.5,         # Agents near central
            "far": 1.5           # Agents far from central
        }
        self.agent_edge_locations: Dict[int, str] = {}  # agent_id -> edge_location
        self.reasoning_cache: Dict[str, Any] = {}  # Cache for edge-local reasoning
        
        # Cheating detection history
        self.player_prediction_history: List[bool] = []  # Track if player predictions were accurate
        
        # ── 2026 Conductor AI Modules ─────────────────────────────────────────────
        self.conductor_config = ConductorConfig()
        
        # Temporal Credit Assignment
        self.temporal_credit = TemporalCreditAssignment(self.conductor_config)
        
        # SeqComm Priority Negotiation
        self.priority_negotiation = PriorityNegotiation(self.conductor_config)
        
        # Leader-Following Dynamics
        self.leader_following = LeaderFollowingSystem(self.conductor_config)
        
        # Goal Partitioning
        self.goal_partitioning = GoalPartitioning(self.conductor_config)
        
        # QMIX Reward Mixing
        self.qmix_reward = QMIXRewardMixing(self.conductor_config)
        
        # Conflict Resolution
        self.conflict_resolution = ConflictResolution(self.conductor_config)
        
        # ── 2026 High-Speed MCP Integration ───────────────────────────────────────
        # The Conductor now uses the optimized SwarmMCP for low-latency coordination
        self.swarm_mcp = SwarmMCP(config, num_agents)
        
        # Initialize tool schema cache
        self._initialize_tool_schemas()
        
        # Set up adjacent zones for each agent (selective context)
        self._initialize_agent_zones()
        
    def create_option(
        self, 
        name: str, 
        duration: int, 
        target_agents: List[int],
        parameters: Dict,
        current_tick: int
    ) -> Option:
        """Create a new macro-instruction option."""
        return Option(
            name=name,
            duration_ticks=duration,
            target_agent_ids=target_agents,
            parameters=parameters,
            start_tick=current_tick,
            confidence=1.0
        )
    
    def issue_instruction(
        self, 
        option_name: str, 
        current_tick: int,
        agent_positions: Dict[int, Tuple[int, int]],
        player_position: Optional[Tuple[int, int]] = None
    ) -> Optional[Option]:
        """Issue a macro-instruction to agents."""
        # Predefined option templates
        option_templates = {
            "INITIATE_PINCER_BALLROOM": {
                "duration": 300,  # 5 seconds
                "agents": [0, 1, 2],  # Hound, Architect, Ghost
                "params": {"formation": "triangle", "target_zone": 19}
            },
            "GASLIGHT_HALL_OF_MIRRORS": {
                "duration": 240,  # 4 seconds
                "agents": [3],  # Gaslighter
                "params": {"zone": 26, "intensity": 0.8}
            },
            "GHOST_AMBUSH_NURSERY": {
                "duration": 180,  # 3 seconds
                "agents": [2],  # Ghost
                "params": {"zone": 18, "stealth_mode": True}
            },
            "FULL_SWARM_CONTAINMENT": {
                "duration": 600,  # 10 seconds
                "agents": [0, 1, 2, 3],  # All except Conductor
                "params": {"strategy": "corral", "target": player_position}
            }
        }
        
        if option_name not in option_templates:
            return None
        
        template = option_templates[option_name]
        return self.create_option(
            option_name,
            template["duration"],
            template["agents"],
            template["params"],
            current_tick
        )
    
    def evaluate_options(
        self, 
        current_tick: int,
        player_position: Optional[Tuple[int, int]] = None
    ) -> List[Option]:
        """Evaluate multiple options using GMM distribution."""
        candidates = []
        
        # Simulate 3-4 different strategies
        strategies = [
            ("INITIATE_PINCER_BALLROOM", 0.7),
            ("GASLIGHT_HALL_OF_MIRRORS", 0.5),
            ("GHOST_AMBUSH_NURSERY", 0.4),
            ("FULL_SWARM_CONTAINMENT", 0.3)
        ]
        
        for strategy_name, base_confidence in strategies:
            if self.player_entropy > 0.5:  # Player is unpredictable
                # Commit to strategy when entropy is high
                option = self.issue_instruction(
                    strategy_name,
                    current_tick,
                    {},
                    player_position
                )
                if option:
                    option.confidence = base_confidence * (1.0 + self.player_entropy)
                    candidates.append(option)
        
        return candidates
    
    def commit_to_option(self, option: Option):
        """Commit to a specific option and activate it."""
        self.active_options.append(option)
        self.traceback_fsm_state = "EXECUTING"
    
    def update_options(self, current_tick: int) -> List[Dict]:
        """Update active options and return agent instructions."""
        instructions = []
        
        for option in self.active_options[:]:
            elapsed = current_tick - option.start_tick
            
            if elapsed >= option.duration_ticks:
                # Option completed
                self.active_options.remove(option)
                self.traceback_fsm_state = "IDLE"
            else:
                # Generate instructions for target agents
                for agent_id in option.target_agent_ids:
                    instructions.append({
                        "agent_id": agent_id,
                        "option": option.name,
                        "parameters": option.parameters,
                        "progress": elapsed / option.duration_ticks
                    })
        
        return instructions
    
    def detect_cheating_oracle(
        self, 
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> bool:
        """Detect if player is using wallhacks (unusual knowledge)."""
        # Check if player consistently moves away from agents without line of sight
        if len(self.player_prediction_history) < 10:
            return False
        
        # Calculate accuracy of player avoidance predictions
        accurate_predictions = sum(self.player_prediction_history[-10:])
        accuracy = accurate_predictions / 10
        
        # If player consistently avoids agents with >90% accuracy without LOS, likely cheating
        return accuracy > 0.9
    
    def calculate_player_entropy(
        self, 
        player_positions: List[Tuple[int, int]]
    ) -> float:
        """Calculate player movement entropy (predictability)."""
        if len(player_positions) < 3:
            return 1.0
        
        # Calculate direction changes
        directions = []
        for i in range(1, len(player_positions)):
            dx = player_positions[i][0] - player_positions[i-1][0]
            dy = player_positions[i][1] - player_positions[i-1][1]
            directions.append(math.atan2(dy, dx))
        
        # Count direction changes
        changes = 0
        for i in range(1, len(directions)):
            if abs(directions[i] - directions[i-1]) > math.pi / 2:
                changes += 1
        
        # More changes = higher entropy = less predictable
        entropy = min(1.0, changes / len(directions))
        self.player_entropy = entropy
        return entropy
    
    def generate_heatmap_of_inevitability(
        self, 
        current_tick: int,
        catch_tick: Optional[int] = None
    ) -> Dict:
        """Generate visualization showing escape probability over time."""
        if catch_tick is None:
            return {}
        
        # In full implementation, would show probability of escape dropping to 0%
        return {
            "catch_tick": catch_tick,
            "escape_probability_10s_before": 0.0,
            "escape_probability_5s_before": 0.0,
            "escape_probability_at_catch": 0.0
        }
    
    def traceback_failed_trap(self, failed_option: Option, current_tick: int):
        """FSM: Rewind and switch strategy when trap fails."""
        self.traceback_fsm_state = "RECOVERING"
        
        # Remove failed option
        if failed_option in self.active_options:
            self.active_options.remove(failed_option)
        
        # Switch to alternative strategy
        if "PINCER" in failed_option.name:
            # Switch to Ghost ambush
            new_option = self.issue_instruction("GHOST_AMBUSH_NURSERY", current_tick, {})
            if new_option:
                self.commit_to_option(new_option)
        elif "GASLIGHT" in failed_option.name:
            # Switch to full containment
            new_option = self.issue_instruction("FULL_SWARM_CONTAINMENT", current_tick, {})
            if new_option:
                self.commit_to_option(new_option)
        
        self.traceback_fsm_state = "EXECUTING"
    
    def assign_agent_edge_location(self, agent_id: int, agent_position: Tuple[int, int]):
        """Assign agent to edge location based on position."""
        # Central edge: Research Chamber area (25-27, 1-4)
        if 25 <= agent_position[0] <= 27 and 1 <= agent_position[1] <= 4:
            self.agent_edge_locations[agent_id] = "central"
        # Near edge: Ballroom, Hall of Mirrors area (20-24, 3-6)
        elif 20 <= agent_position[0] <= 24 and 3 <= agent_position[1] <= 6:
            self.agent_edge_locations[agent_id] = "near"
        # Far edge: All other areas
        else:
            self.agent_edge_locations[agent_id] = "far"
    
    def get_edge_latency(self, agent_id: int) -> float:
        """Get latency for agent based on edge location."""
        edge_loc = self.agent_edge_locations.get(agent_id, "far")
        return self.edge_latency.get(edge_loc, 1.5)
    
    def cache_reasoning(self, cache_key: str, reasoning_result: Any, ttl: int = 60):
        """Cache reasoning result at edge for sub-second cold starts."""
        self.reasoning_cache[cache_key] = {
            "result": reasoning_result,
            "expires_at": time.time() + ttl
        }
    
    def get_cached_reasoning(self, cache_key: str) -> Optional[Any]:
        """Retrieve cached reasoning result."""
        cached = self.reasoning_cache.get(cache_key)
        if cached and time.time() < cached["expires_at"]:
            return cached["result"]
        elif cached:
            del self.reasoning_cache[cache_key]
        return None
    
    def cleanup_expired_cache(self):
        """Clean up expired cache entries."""
        now = time.time()
        expired = [
            key for key, entry in self.reasoning_cache.items()
            if now >= entry["expires_at"]
        ]
        for key in expired:
            del self.reasoning_cache[key]
    
    # ── 2026 Conductor AI Coordination Methods ─────────────────────────────────────
    
    def coordinate_swarm(
        self,
        current_tick: int,
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]],
        agent_ids: List[int]
    ) -> Dict[str, Any]:
        """
        Main coordination loop - integrates all 2026 coordination fixes.
        Called every tick to orchestrate the swarm.
        """
        coordination_result = {
            "tick": current_tick,
            "active_goal": None,
            "negotiation_result": None,
            "leader_assignment": None,
            "policy_assignments": [],
            "conflict_resolutions": [],
            "joint_reward": 0.0
        }
        
        # 1. Temporal Credit Assignment: Create or evaluate high-level goal
        if not self.temporal_credit.active_goals or current_tick % self.conductor_config.GOAL_EVALUATION_INTERVAL == 0:
            # Create new goal based on player state
            goal_type = self._determine_goal_type(player_position, agent_positions)
            goal_id = self.temporal_credit.create_goal(
                goal_type=goal_type,
                target_position=player_position,
                priority=1.0
            )
            
            # Assign all agents to the goal
            for agent_id in agent_ids:
                self.temporal_credit.assign_agent_to_goal(goal_id, agent_id)
            
            coordination_result["active_goal"] = {
                "goal_id": goal_id,
                "goal_type": goal_type.value,
                "target_position": player_position
            }
        
        # Evaluate existing goals
        for goal_id in list(self.temporal_credit.active_goals.keys()):
            evaluation = self.temporal_credit.evaluate_goal(goal_id, player_position, agent_positions)
            coordination_result["goal_evaluation"] = evaluation
        
        # Cleanup expired goals
        self.temporal_credit.cleanup_expired_goals()
        
        # 2. SeqComm Priority Negotiation
        if current_tick % self.conductor_config.NEGOTIATION_INTERVAL == 0:
            # Register intentions based on agent roles and positions
            for agent_id in agent_ids:
                intention = self._determine_agent_intention(agent_id, player_position, agent_positions)
                value = self._calculate_intention_value(agent_id, player_position, agent_positions)
                self.priority_negotiation.register_intention(agent_id, intention, value)
            
            # Run negotiation
            negotiation_result = self.priority_negotiation.negotiate(agent_ids, player_position, agent_positions)
            coordination_result["negotiation_result"] = negotiation_result
            
            # Decay intentions
            self.priority_negotiation.decay_intentions()
        
        # 3. Leader-Following Dynamics
        if self.leader_following.should_reassign():
            # Assign leader based on negotiation result or proximity
            leader_id = self._select_leader(agent_ids, player_position, agent_positions)
            followers = [aid for aid in agent_ids if aid != leader_id]
            self.leader_following.assign_leader(leader_id, followers)
            
            coordination_result["leader_assignment"] = {
                "leader_id": leader_id,
                "follower_ids": followers
            }
        
        # 4. Goal Partitioning
        if self.temporal_credit.active_goals:
            active_goal = list(self.temporal_credit.active_goals.values())[0]
            policy_assignments = self.goal_partitioning.partition_goal(active_goal.goal_type, agent_ids)
            coordination_result["policy_assignments"] = policy_assignments
        
        # Cleanup policy cooldowns
        self.goal_partitioning.cleanup_cooldowns()
        
        # 5. Conflict Resolution
        agent_goals = {}
        for agent_id in agent_ids:
            sub_policy = self.goal_partitioning.get_sub_policy(agent_id)
            agent_goals[agent_id] = sub_policy.value
        
        conflicts = self.conflict_resolution.detect_conflict(agent_positions, agent_goals)
        for conflict in conflicts:
            resolution = self.conflict_resolution.resolve_conflict(
                conflict,
                self.leader_following.agent_roles,
                {aid: self.priority_negotiation.agent_intentions.get(aid, AgentIntention(aid, "", 0.0)).value for aid in agent_ids}
            )
            coordination_result["conflict_resolutions"].append(resolution)
        
        # Cleanup stale conflicts
        self.conflict_resolution.cleanup_stale_conflicts()
        
        # 6. QMIX Joint Reward Calculation
        if self.temporal_credit.active_goals:
            active_goal = list(self.temporal_credit.active_goals.values())[0]
            joint_result = self.qmix_reward.calculate_joint_reward(agent_ids, active_goal.progress)
            coordination_result["joint_reward"] = joint_result.joint_reward
            coordination_result["monotonicity_satisfied"] = joint_result.monotonicity_satisfied
        
        return coordination_result
    
    def _determine_goal_type(
        self,
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> GoalType:
        """Determine the appropriate high-level goal based on game state."""
        # Check if player is near exit
        if player_position[0] > 20:  # Near right side (exit area)
            return GoalType.SECURE_EXIT
        
        # Check if agents are surrounding player
        surrounding_count = 0
        for agent_pos in agent_positions.values():
            dist = math.sqrt((agent_pos[0] - player_position[0])**2 + (agent_pos[1] - player_position[1])**2)
            if dist < 5:
                surrounding_count += 1
        
        if surrounding_count >= 2:
            return GoalType.ENCIRCLE_PLAYER
        
        # Default: patrol
        return GoalType.PATROL_ZONE
    
    def _determine_agent_intention(
        self,
        agent_id: int,
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> str:
        """Determine an agent's intention based on its role and position."""
        role = self.leader_following.get_role(agent_id)
        agent_pos = agent_positions.get(agent_id, (0, 0))
        
        if role == ConductorAgentRole.LEADER:
            return "chase"
        elif role == ConductorAgentRole.FOLLOWER:
            return "support"
        else:
            # Independent agents patrol
            return "patrol"
    
    def _calculate_intention_value(
        self,
        agent_id: int,
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> float:
        """Calculate the value score of an agent's intention."""
        agent_pos = agent_positions.get(agent_id, (0, 0))
        dist = math.sqrt((agent_pos[0] - player_position[0])**2 + (agent_pos[1] - player_position[1])**2)
        
        # Closer agents have higher value for chase intentions
        value = 1.0 - min(1.0, dist / 20.0)
        return value
    
    def _select_leader(
        self,
        agent_ids: List[int],
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> int:
        """Select the best leader based on proximity and role."""
        best_agent = agent_ids[0]
        best_distance = float('inf')
        
        for agent_id in agent_ids:
            agent_pos = agent_positions.get(agent_id, (0, 0))
            dist = math.sqrt((agent_pos[0] - player_position[0])**2 + (agent_pos[1] - player_position[1])**2)
            
            if dist < best_distance:
                best_distance = dist
                best_agent = agent_id
        
        return best_agent
    
    def get_agent_instructions(
        self,
        agent_id: int,
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> Dict[str, Any]:
        """
        Get specific instructions for a single agent based on its role and sub-policy.
        """
        role = self.leader_following.get_role(agent_id)
        sub_policy = self.goal_partitioning.get_sub_policy(agent_id)
        
        instructions = {
            "agent_id": agent_id,
            "role": role.value,
            "sub_policy": sub_policy.value,
            "target_position": None,
            "mode": "patrol"
        }
        
        agent_pos = agent_positions.get(agent_id, (0, 0))
        
        if role == ConductorAgentRole.LEADER:
            # Leader chases player directly
            instructions["target_position"] = player_position
            instructions["mode"] = "chase"
        
        elif role == ConductorAgentRole.FOLLOWER:
            # Follower calculates support position
            leader_id = None
            for aid, r in self.leader_following.agent_roles.items():
                if r == ConductorAgentRole.LEADER:
                    leader_id = aid
                    break
            
            if leader_id:
                leader_pos = agent_positions.get(leader_id, agent_pos)
                follower_index = list(self.leader_following.agent_roles.keys()).index(agent_id)
                total_followers = len([r for r in self.leader_following.agent_roles.values() if r == ConductorAgentRole.FOLLOWER])
                
                support_pos = self.leader_following.calculate_support_position(
                    leader_pos, player_position, follower_index, total_followers
                )
                instructions["target_position"] = support_pos
                instructions["mode"] = "support"
        
        elif sub_policy == SubPolicy.BLOCK:
            # Blocker positions between player and exit
            instructions["target_position"] = (player_position[0] + 5, player_position[1])
            instructions["mode"] = "block"
        
        elif sub_policy == SubPolicy.FLANK:
            # Flanker moves to side of player
            instructions["target_position"] = (player_position[0], player_position[1] + 3)
            instructions["mode"] = "flank"
        
        return instructions
    
    # ── 2026 MCP Integration Helper Methods ───────────────────────────────────────
    
    def _initialize_tool_schemas(self) -> None:
        """Initialize tool schema cache for all available tools."""
        tool_schemas = {
            "tile_swap": {
                "description": "Swap two tiles on the map",
                "parameters": {"tile1": "int", "tile2": "int", "zone": "int"}
            },
            "audio_distortion": {
                "description": "Apply audio distortion effect",
                "parameters": {"intensity": "float", "duration": "float"}
            },
            "light_flicker": {
                "description": "Flicker lights in a zone",
                "parameters": {"zone": "int", "frequency": "float"}
            },
            "door_lock": {
                "description": "Lock or unlock a door",
                "parameters": {"door_id": "int", "locked": "bool"}
            },
            "visual_lock": {
                "description": "Set visual lock on player position",
                "parameters": {"position": "tuple", "confidence": "float"}
            }
        }
        
        for tool_name, schema in tool_schemas.items():
            self.swarm_mcp.cache_tool_schema(tool_name, schema)
    
    def _initialize_agent_zones(self) -> None:
        """Initialize adjacent zones for each agent (selective context)."""
        # Zone adjacency map (simplified)
        zone_adjacency = {
            0: {1, 2},  # Entrance Hall
            1: {0, 3, 4},  # Corridor
            2: {0, 5},  # Another corridor
            3: {1, 6},  # Room
            4: {1, 7},  # Room
            5: {2, 8},  # Room
            6: {3, 9},  # Room
            7: {4, 10},  # Room
            8: {5, 11},  # Room
            9: {6, 12},  # Attic
            10: {7, 13},  # Basement
            11: {8, 14},  # Room
            12: {9, 15},  # Room
            13: {10, 16},  # Wine Cellar
            14: {11, 17},  # Room
            15: {12, 18},  # Nursery
            16: {13, 19},  # Ballroom
            17: {14, 20},  # Room
            18: {15, 21},  # Catacombs
            19: {16, 22},  # Hall of Mirrors
            20: {17, 23},  # Room
            21: {18, 24},  # Room
            22: {19, 25},  # Room
            23: {20, 26},  # Room
            24: {21, 27},  # Room
            25: {22, 28},  # Room
            26: {23, 29},  # Room
            27: {24},  # Room
            28: {25},  # Research Chamber
            29: {26}  # The Void
        }
        
        # Assign adjacent zones to each agent
        for agent_id in range(self.num_agents):
            # Start with all zones, will be filtered dynamically
            self.swarm_mcp.set_adjacent_zones(agent_id, set(range(30)))
    
    def coordinate_swarm_2026(
        self,
        current_tick: int,
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]],
        agent_zones: Dict[int, int]
    ) -> Dict[str, Any]:
        """
        2026 High-Speed coordination loop with MCP integration.
        Combines Conductor coordination with MCP event-driven architecture.
        """
        # First, update MCP with current state
        mcp_status = self.swarm_mcp.update_mcp_2026(
            current_tick, player_position, agent_positions, agent_zones
        )
        
        # Check for visual lock from blackboard (A2A communication)
        visual_lock = self.swarm_mcp.get_visual_lock()
        if visual_lock:
            # Use visual lock position instead of estimated player position
            player_position = visual_lock["player_position"]
        
        # Run standard coordination
        coordination_result = self.coordinate_swarm(
            current_tick, player_position, agent_positions, list(agent_zones.keys())
        )
        
        # Calculate joint reward at MCP level (QMIX monotonicity)
        if self.temporal_credit.active_goals:
            active_goal = list(self.temporal_credit.active_goals.values())[0]
            individual_rewards = {
                aid: self.swarm_mcp.agent_individual_rewards.get(aid, 0.0)
                for aid in agent_zones.keys()
            }
            
            mcp_reward = self.swarm_mcp.calculate_mcp_joint_reward(
                list(agent_zones.keys()),
                individual_rewards,
                active_goal.progress
            )
            
            coordination_result["mcp_joint_reward"] = mcp_reward["joint_reward"]
            coordination_result["mcp_monotonicity"] = mcp_reward["monotonicity_satisfied"]
        
        # Add MCP status to result
        coordination_result["mcp_status"] = mcp_status
        
        return coordination_result


# ── Conductor AI: Manager-Worker Architecture ─────────────────────────────────────
# Implements 2026 coordination fixes: Temporal Credit Assignment, SeqComm,
# Leader-Following, Goal Partitioning, QMIX Monotonicity, Conflict Resolution

# Conductor Configuration
@dataclass
class ConductorConfig:
    # Temporal Credit Assignment settings
    GOAL_DURATION_TICKS: int = 1800  # 30 seconds at 60 ticks/sec
    GOAL_EVALUATION_INTERVAL: int = 300  # Evaluate every 5 seconds
    
    # SeqComm Priority Negotiation settings
    NEGOTIATION_INTERVAL: int = 60  # Negotiate every 1 second
    PRIORITY_DECAY: float = 0.95
    VALUE_INTENTION_THRESHOLD: float = 0.7
    
    # Leader-Following settings
    LEADER_ASSIGNMENT_INTERVAL: int = 600  # Reassign every 10 seconds
    FOLLOWER_SUPPORT_DISTANCE: float = 5.0
    
    # Goal Partitioning settings
    SUB_POLICY_COUNT: int = 4
    POLICY_SWITCH_COOLDOWN: int = 120
    
    # QMIX-style Monotonicity settings
    MONOTONICITY_WEIGHT: float = 0.8
    INDIVIDUAL_REWARD_WEIGHT: float = 0.2
    
    # Conflict Resolution settings
    ASYNC_NEGOTIATION_TIMEOUT: int = 30
    CONFLICT_RESOLUTION_PRIORITY: List[str] = field(default_factory=lambda: ["leader", "value_intention", "proximity"])


# High-Level Goal Types
class GoalType(Enum):
    SECURE_EXIT = "secure_exit"
    ENCIRCLE_PLAYER = "encircle_player"
    FLUSH_PLAYER = "flush_player"
    PATROL_ZONE = "patrol_zone"
    AMBUSH_PATH = "ambush_path"
    BLOCK_CORRIDOR = "block_corridor"


# Sub-Policy Types (Goal Partitioning)
class SubPolicy(Enum):
    CHASE = "chase"
    FLANK = "flank"
    PATROL = "patrol"
    AMBUSH = "ambush"
    SUPPORT = "support"
    BLOCK = "block"


# Agent Role Types for Conductor
class ConductorAgentRole(Enum):
    LEADER = "leader"
    FOLLOWER = "follower"
    INDEPENDENT = "independent"


# ── Temporal Credit Assignment Module ─────────────────────────────────────────────

@dataclass
class HighLevelGoal:
    goal_id: int
    goal_type: GoalType
    target_position: Tuple[int, int]
    duration_ticks: int
    priority: float = 1.0
    start_time: float = field(default_factory=time.time)
    progress: float = 0.0
    completed: bool = False
    failed: bool = False
    assigned_agents: Set[int] = field(default_factory=set)
    
    @property
    def elapsed_ticks(self) -> int:
        return int((time.time() - self.start_time) * 60)  # Approx 60 ticks/sec
    
    @property
    def remaining_ticks(self) -> int:
        return max(0, self.duration_ticks - self.elapsed_ticks)
    
    @property
    def is_expired(self) -> bool:
        return self.elapsed_ticks >= self.duration_ticks


class TemporalCreditAssignment:
    """
    Solves the "delayed reward" problem by setting high-level goals that last
    for 30 seconds and evaluating workers based on whether the goal was met.
    """
    
    def __init__(self, config: ConductorConfig):
        self.config = config
        self.active_goals: Dict[int, HighLevelGoal] = {}
        self.goal_history: List[Dict] = []
        self.current_goal_id = 0
    
    def create_goal(
        self,
        goal_type: GoalType,
        target_position: Tuple[int, int],
        duration_ticks: int = None,
        priority: float = 1.0
    ) -> int:
        """Create a new high-level goal."""
        if duration_ticks is None:
            duration_ticks = self.config.GOAL_DURATION_TICKS
        
        goal_id = self.current_goal_id
        self.current_goal_id += 1
        
        goal = HighLevelGoal(
            goal_id=goal_id,
            goal_type=goal_type,
            target_position=target_position,
            duration_ticks=duration_ticks,
            priority=priority
        )
        
        self.active_goals[goal_id] = goal
        return goal_id
    
    def assign_agent_to_goal(self, goal_id: int, agent_id: int) -> bool:
        """Assign a worker (stalker) to a goal."""
        goal = self.active_goals.get(goal_id)
        if goal:
            goal.assigned_agents.add(agent_id)
            return True
        return False
    
    def evaluate_goal(
        self,
        goal_id: int,
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> Dict[str, Any]:
        """Evaluate goal progress and calculate reward."""
        goal = self.active_goals.get(goal_id)
        if not goal:
            return {"error": "Goal not found"}
        
        progress = 0.0
        reward = 0.0
        
        if goal.goal_type == GoalType.SECURE_EXIT:
            # Evaluate if exit is secured
            dist_to_exit = self._distance_to(player_position, goal.target_position)
            progress = 1.0 - min(1.0, dist_to_exit / 20.0)
            reward = progress * goal.priority
        
        elif goal.goal_type == GoalType.ENCIRCLE_PLAYER:
            # Evaluate if player is surrounded
            surrounding_agents = self._count_surrounding_agents(
                goal.assigned_agents, player_position, agent_positions
            )
            progress = min(1.0, surrounding_agents / 3.0)
            reward = progress * goal.priority
        
        elif goal.goal_type == GoalType.FLUSH_PLAYER:
            # Evaluate if player was moved toward target
            dist_to_target = self._distance_to(player_position, goal.target_position)
            progress = 1.0 - min(1.0, dist_to_target / 15.0)
            reward = progress * goal.priority
        
        elif goal.goal_type == GoalType.PATROL_ZONE:
            # Evaluate if zone is being patrolled
            active_patrollers = len(goal.assigned_agents)
            progress = min(1.0, active_patrollers / 2.0)
            reward = progress * goal.priority
        
        else:
            progress = goal.progress
            reward = progress * goal.priority
        
        goal.progress = progress
        if progress >= 1.0:
            goal.completed = True
        
        return {
            "goal_id": goal_id,
            "progress": progress,
            "reward": reward,
            "completed": goal.completed,
            "failed": goal.failed,
            "remaining_ticks": goal.remaining_ticks
        }
    
    def cleanup_expired_goals(self) -> List[Dict]:
        """Remove expired or completed goals and return history."""
        completed_goals = []
        
        for goal_id, goal in list(self.active_goals.items()):
            if goal.is_expired or goal.completed or goal.failed:
                completed_goals.append({
                    "goal_id": goal_id,
                    "goal_type": goal.goal_type.value,
                    "progress": goal.progress,
                    "completed": goal.completed,
                    "failed": goal.failed,
                    "duration": goal.elapsed_ticks
                })
                del self.active_goals[goal_id]
        
        self.goal_history.extend(completed_goals)
        return completed_goals
    
    def _distance_to(self, pos1: Tuple[int, int], pos2: Tuple[int, int]) -> float:
        return math.sqrt((pos1[0] - pos2[0])**2 + (pos1[1] - pos2[1])**2)
    
    def _count_surrounding_agents(
        self,
        agent_ids: Set[int],
        player_pos: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> int:
        count = 0
        for agent_id in agent_ids:
            agent_pos = agent_positions.get(agent_id)
            if agent_pos and self._distance_to(agent_pos, player_pos) < 5:
                count += 1
        return count


# ── Sequential Decision-Making (SeqComm) Module ────────────────────────────────────

@dataclass
class AgentIntention:
    agent_id: int
    intention: str
    value: float
    timestamp: float = field(default_factory=time.time)


class PriorityNegotiation:
    """
    Implements SeqComm to stop agents from "spinning in circles."
    Determines which agent has the "highest value intention" and grants them
    First Mover right, while others adjust their paths to support.
    """
    
    def __init__(self, config: ConductorConfig):
        self.config = config
        self.agent_intentions: Dict[int, AgentIntention] = {}
        self.negotiation_history: List[Dict] = []
        self.current_round = 0
    
    def register_intention(self, agent_id: int, intention: str, value: float) -> None:
        """Register an agent's intention with its value score."""
        self.agent_intentions[agent_id] = AgentIntention(
            agent_id=agent_id,
            intention=intention,
            value=value
        )
    
    def negotiate(
        self,
        agent_ids: List[int],
        player_position: Tuple[int, int],
        agent_positions: Dict[int, Tuple[int, int]]
    ) -> Dict[str, Any]:
        """Run priority negotiation and return First Mover assignment."""
        self.current_round += 1
        
        # Sort agents by value intention (highest first)
        sorted_agents = []
        for agent_id in agent_ids:
            intention = self.agent_intentions.get(agent_id)
            if intention and intention.value >= self.config.VALUE_INTENTION_THRESHOLD:
                sorted_agents.append((agent_id, intention))
        
        sorted_agents.sort(key=lambda x: x[1].value, reverse=True)
        
        negotiation_result = {
            "round": self.current_round,
            "first_mover": None,
            "followers": [],
            "intentions": {},
            "adjusted_intentions": {}
        }
        
        if sorted_agents:
            # Grant First Mover right to highest value intention
            first_mover_id, first_mover_intention = sorted_agents[0]
            followers = [aid for aid, _ in sorted_agents[1:]]
            
            negotiation_result["first_mover"] = first_mover_id
            negotiation_result["followers"] = followers
            negotiation_result["intentions"][first_mover_id] = first_mover_intention.intention
            
            # Adjust follower intentions to support
            for follower_id, _ in followers:
                support_intention = self._generate_support_intention(
                    first_mover_intention.intention,
                    player_position,
                    agent_positions.get(follower_id, (0, 0))
                )
                self.agent_intentions[follower_id].intention = support_intention
                negotiation_result["adjusted_intentions"][follower_id] = support_intention
        
        self.negotiation_history.append(negotiation_result)
        return negotiation_result
    
    def _generate_support_intention(
        self,
        primary_intention: str,
        player_pos: Tuple[int, int],
        follower_pos: Tuple[int, int]
    ) -> str:
        """Generate supporting intention based on primary."""
        support_map = {
            "secure_exit": SubPolicy.BLOCK.value,
            "encircle_player": SubPolicy.FLANK.value,
            "flush_player": SubPolicy.SUPPORT.value,
            "patrol_zone": SubPolicy.PATROL.value,
            "ambush_path": SubPolicy.AMBUSH.value,
        }
        return support_map.get(primary_intention, SubPolicy.PATROL.value)
    
    def decay_intentions(self) -> None:
        """Decay intention values over time."""
        for intention in self.agent_intentions.values():
            intention.value *= self.config.PRIORITY_DECAY


# ── Leader-Following Dynamics Module ─────────────────────────────────────────────

@dataclass
class LeaderAssignment:
    leader_id: int
    follower_ids: List[int]
    timestamp: float = field(default_factory=time.time)


class LeaderFollowingSystem:
    """
    Designates one Stalker as the Leader for a specific chase, while others
    are assigned as Followers. Reduces coordination cost and prevents redundant actions.
    """
    
    def __init__(self, config: ConductorConfig):
        self.config = config
        self.agent_roles: Dict[int, ConductorAgentRole] = {}
        self.leader_history: List[LeaderAssignment] = []
        self.last_assignment: float = 0.0
    
    def assign_leader(self, leader_id: int, follower_ids: List[int]) -> None:
        """Assign a leader and its followers."""
        self.agent_roles[leader_id] = ConductorAgentRole.LEADER
        for follower_id in follower_ids:
            self.agent_roles[follower_id] = ConductorAgentRole.FOLLOWER
        
        self.last_assignment = time.time()
        self.leader_history.append(LeaderAssignment(leader_id, follower_ids))
    
    def get_role(self, agent_id: int) -> ConductorAgentRole:
        """Get the role of an agent."""
        return self.agent_roles.get(agent_id, ConductorAgentRole.INDEPENDENT)
    
    def get_followers(self, leader_id: int) -> List[int]:
        """Get all followers of a leader."""
        followers = []
        for agent_id, role in self.agent_roles.items():
            if role == ConductorAgentRole.FOLLOWER:
                followers.append(agent_id)
        return followers
    
    def should_reassign(self) -> bool:
        """Check if leader should be reassigned."""
        return time.time() - self.last_assignment > self.config.LEADER_ASSIGNMENT_INTERVAL
    
    def calculate_support_position(
        self,
        leader_pos: Tuple[int, int],
        player_pos: Tuple[int, int],
        follower_index: int,
        total_followers: int
    ) -> Tuple[float, float]:
        """Calculate flanking positions around the leader."""
        # Calculate angle from leader to player
        dx = player_pos[0] - leader_pos[0]
        dy = player_pos[1] - leader_pos[1]
        base_angle = math.atan2(dy, dx)
        
        # Distribute followers around the leader
        angle_offset = (2 * math.pi * follower_index) / total_followers
        angle = base_angle + angle_offset
        
        distance = self.config.FOLLOWER_SUPPORT_DISTANCE
        
        support_x = leader_pos[0] + math.cos(angle) * distance
        support_y = leader_pos[1] + math.sin(angle) * distance
        
        return (support_x, support_y)
    
    def clear_assignments(self) -> None:
        """Clear all role assignments."""
        self.agent_roles.clear()


# ── Goal Partitioning Module ───────────────────────────────────────────────────────

@dataclass
class SubPolicyAssignment:
    agent_id: int
    sub_policy: SubPolicy
    goal_type: GoalType
    assigned_at: float = field(default_factory=time.time)


class GoalPartitioning:
    """
    Implements sub-policy selection based on player state.
    Prevents all 4 agents from doing the same thing.
    """
    
    def __init__(self, config: ConductorConfig):
        self.config = config
        self.agent_sub_policies: Dict[int, SubPolicyAssignment] = {}
        self.policy_cooldowns: Dict[int, float] = {}
    
    def assign_sub_policy(
        self,
        agent_id: int,
        sub_policy: SubPolicy,
        goal_type: GoalType
    ) -> bool:
        """Assign a sub-policy to an agent."""
        if self._is_on_cooldown(agent_id):
            return False
        
        self.agent_sub_policies[agent_id] = SubPolicyAssignment(
            agent_id=agent_id,
            sub_policy=sub_policy,
            goal_type=goal_type
        )
        
        cooldown_end = time.time() + self.config.POLICY_SWITCH_COOLDOWN
        self.policy_cooldowns[agent_id] = cooldown_end
        return True
    
    def get_sub_policy(self, agent_id: int) -> SubPolicy:
        """Get the current sub-policy for an agent."""
        assignment = self.agent_sub_policies.get(agent_id)
        return assignment.sub_policy if assignment else SubPolicy.PATROL
    
    def partition_goal(
        self,
        goal_type: GoalType,
        agent_ids: List[int]
    ) -> List[Dict[str, Any]]:
        """Distribute sub-policies based on goal type."""
        assignments = []
        policy_distribution = self._get_policy_distribution(goal_type)
        
        for index, agent_id in enumerate(agent_ids):
            sub_policy = policy_distribution[index % len(policy_distribution)]
            success = self.assign_sub_policy(agent_id, sub_policy, goal_type)
            
            assignments.append({
                "agent_id": agent_id,
                "sub_policy": sub_policy.value,
                "success": success
            })
        
        return assignments
    
    def _get_policy_distribution(self, goal_type: GoalType) -> List[SubPolicy]:
        """Get the policy distribution for a goal type."""
        distributions = {
            GoalType.SECURE_EXIT: [
                SubPolicy.CHASE, SubPolicy.BLOCK, SubPolicy.BLOCK, SubPolicy.PATROL
            ],
            GoalType.ENCIRCLE_PLAYER: [
                SubPolicy.CHASE, SubPolicy.FLANK, SubPolicy.FLANK, SubPolicy.AMBUSH
            ],
            GoalType.FLUSH_PLAYER: [
                SubPolicy.CHASE, SubPolicy.SUPPORT, SubPolicy.SUPPORT, SubPolicy.PATROL
            ],
            GoalType.PATROL_ZONE: [
                SubPolicy.PATROL, SubPolicy.PATROL, SubPolicy.PATROL, SubPolicy.PATROL
            ],
            GoalType.AMBUSH_PATH: [
                SubPolicy.AMBUSH, SubPolicy.FLANK, SubPolicy.FLANK, SubPolicy.BLOCK
            ],
            GoalType.BLOCK_CORRIDOR: [
                SubPolicy.BLOCK, SubPolicy.BLOCK, SubPolicy.SUPPORT, SubPolicy.PATROL
            ],
        }
        return distributions.get(goal_type, [SubPolicy.PATROL] * 4)
    
    def _is_on_cooldown(self, agent_id: int) -> bool:
        """Check if agent is on policy switch cooldown."""
        cooldown_end = self.policy_cooldowns.get(agent_id)
        return cooldown_end and time.time() < cooldown_end
    
    def cleanup_cooldowns(self) -> None:
        """Clean up expired cooldowns."""
        now = time.time()
        expired = [aid for aid, end in self.policy_cooldowns.items() if now >= end]
        for agent_id in expired:
            del self.policy_cooldowns[agent_id]


# ── Joint Reward Mixing (QMIX-style Monotonicity) Module ───────────────────────────

@dataclass
class RewardMixingResult:
    joint_reward: float
    individual_rewards: Dict[int, float]
    monotonicity_satisfied: bool


class QMIXRewardMixing:
    """
    Implements QMIX-style Monotonicity to ensure that an individual agent's
    "win" actually helps the whole team.
    """
    
    def __init__(self, config: ConductorConfig):
        self.config = config
        self.individual_rewards: Dict[int, float] = {}
        self.joint_rewards: Dict[int, float] = {}
        self.monotonicity_weights: Dict[int, float] = {}
    
    def record_individual_reward(self, agent_id: int, reward: float) -> None:
        """Record an individual agent's reward."""
        self.individual_rewards[agent_id] = reward
    
    def calculate_joint_reward(
        self,
        agent_ids: List[int],
        goal_progress: float
    ) -> RewardMixingResult:
        """Calculate joint reward using QMIX monotonic mixing."""
        # Weight individual rewards
        weighted_individual = sum(
            self.individual_rewards.get(aid, 0.0) * self.config.INDIVIDUAL_REWARD_WEIGHT
            for aid in agent_ids
        )
        
        # Weight joint goal progress
        weighted_joint = goal_progress * self.config.MONOTONICITY_WEIGHT
        
        # Mix rewards
        joint_reward = weighted_individual + weighted_joint
        
        # Check monotonicity: joint reward should increase with individual improvements
        monotonicity_satisfied = self._check_monotonicity(agent_ids, joint_reward)
        
        result = RewardMixingResult(
            joint_reward=joint_reward,
            individual_rewards=self.individual_rewards.copy(),
            monotonicity_satisfied=monotonicity_satisfied
        )
        
        self.joint_rewards[time.time()] = joint_reward
        return result
    
    def _check_monotonicity(self, agent_ids: List[int], current_joint: float) -> bool:
        """Check if monotonicity constraint is satisfied."""
        if len(self.joint_rewards) < 2:
            return True
        
        # Get previous joint reward
        prev_joint = list(self.joint_rewards.values())[-1]
        
        # Monotonicity: current should be >= previous if individual rewards increased
        total_individual = sum(self.individual_rewards.get(aid, 0.0) for aid in agent_ids)
        prev_total = sum(
            self.individual_rewards.get(aid, 0.0) for aid in agent_ids
        ) if len(self.individual_rewards) > 0 else 0
        
        if total_individual >= prev_total:
            return current_joint >= prev_joint
        
        return True
    
    def get_reward_history(self) -> List[float]:
        """Get history of joint rewards."""
        return list(self.joint_rewards.values())


# ── Conflict Resolution (Asynchronous Negotiation) Module ───────────────────────

@dataclass
class Conflict:
    conflict_id: int
    conflicting_agents: List[int]
    conflict_type: str  # "tile_conflict", "path_conflict", "goal_conflict"
    timestamp: float = field(default_factory=time.time)
    resolved: bool = False


class ConflictResolution:
    """
    Implements Asynchronous Negotiation to break "ties" where two agents
    want the same tile or resource.
    """
    
    def __init__(self, config: ConductorConfig):
        self.config = config
        self.active_conflicts: Dict[int, Conflict] = {}
        self.conflict_history: List[Conflict] = []
        self.current_conflict_id = 0
    
    def detect_conflict(
        self,
        agent_positions: Dict[int, Tuple[int, int]],
        agent_goals: Dict[int, str]
    ) -> List[Conflict]:
        """Detect conflicts between agents."""
        detected = []
        
        # Detect tile conflicts (agents targeting same position)
        position_map: Dict[Tuple[int, int], List[int]] = {}
        for agent_id, pos in agent_positions.items():
            if pos not in position_map:
                position_map[pos] = []
            position_map[pos].append(agent_id)
        
        for pos, agents in position_map.items():
            if len(agents) > 1:
                conflict_id = self.current_conflict_id
                self.current_conflict_id += 1
                
                conflict = Conflict(
                    conflict_id=conflict_id,
                    conflicting_agents=agents,
                    conflict_type="tile_conflict"
                )
                self.active_conflicts[conflict_id] = conflict
                detected.append(conflict)
        
        # Detect goal conflicts (agents with same goal type)
        goal_map: Dict[str, List[int]] = {}
        for agent_id, goal in agent_goals.items():
            if goal not in goal_map:
                goal_map[goal] = []
            goal_map[goal].append(agent_id)
        
        for goal, agents in goal_map.items():
            if len(agents) > 2:  # More than 2 agents on same goal
                conflict_id = self.current_conflict_id
                self.current_conflict_id += 1
                
                conflict = Conflict(
                    conflict_id=conflict_id,
                    conflicting_agents=agents,
                    conflict_type="goal_conflict"
                )
                self.active_conflicts[conflict_id] = conflict
                detected.append(conflict)
        
        return detected
    
    def resolve_conflict(
        self,
        conflict: Conflict,
        agent_roles: Dict[int, ConductorAgentRole],
        agent_values: Dict[int, float]
    ) -> Dict[str, Any]:
        """Resolve a conflict using priority-based negotiation."""
        resolution = {
            "conflict_id": conflict.conflict_id,
            "resolution_type": None,
            "winner": None,
            "losers": [],
            "adjustments": {}
        }
        
        # Apply conflict resolution priority
        for priority in self.config.CONFLICT_RESOLUTION_PRIORITY:
            if priority == "leader":
                # Leader wins
                for agent_id in conflict.conflicting_agents:
                    if agent_roles.get(agent_id) == ConductorAgentRole.LEADER:
                        resolution["winner"] = agent_id
                        resolution["resolution_type"] = "leader_priority"
                        break
            
            elif priority == "value_intention" and resolution["winner"] is None:
                # Highest value intention wins
                sorted_agents = sorted(
                    conflict.conflicting_agents,
                    key=lambda aid: agent_values.get(aid, 0.0),
                    reverse=True
                )
                if sorted_agents:
                    resolution["winner"] = sorted_agents[0]
                    resolution["resolution_type"] = "value_priority"
            
            elif priority == "proximity" and resolution["winner"] is None:
                # Closest to target wins (simplified: first in list)
                if conflict.conflicting_agents:
                    resolution["winner"] = conflict.conflicting_agents[0]
                    resolution["resolution_type"] = "proximity_priority"
            
            if resolution["winner"] is not None:
                break
        
        # Set losers and adjustments
        if resolution["winner"]:
            resolution["losers"] = [
                aid for aid in conflict.conflicting_agents if aid != resolution["winner"]
            ]
            for loser in resolution["losers"]:
                resolution["adjustments"][loser] = "retreat_or_support"
        
        conflict.resolved = True
        self.conflict_history.append(conflict)
        del self.active_conflicts[conflict.conflict_id]
        
        return resolution
    
    def cleanup_stale_conflicts(self) -> List[Conflict]:
        """Remove conflicts that have timed out."""
        stale = []
        now = time.time()
        
        for conflict_id, conflict in list(self.active_conflicts.items()):
            if now - conflict.timestamp > self.config.ASYNC_NEGOTIATION_TIMEOUT:
                stale.append(conflict)
                del self.active_conflicts[conflict_id]
        
        return stale


# ── Agent Roles (Elite Trio) ─────────────────────────────────────────────────────

class AgentRole(Enum):
    ARCHITECT = "architect"      # Strategic lead, MCTS-focused
    HOUND = "hound"              # Aggressor, PPO-focused
    GHOST = "ghost"              # Saboteur, stealth-focused
    GASLIGHTER = "gaslighter"    # Deceptive, sensory sabotage
    CONDUCTOR = "conductor"      # Orchestrator, hierarchical meta-RL


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
    AgentRole.GASLIGHTER: RoleConstraints(
        max_engagement_distance=12.0,  # Operates at medium range
        min_patience_ticks=15,          # Quick deception cycles
        max_movement_per_tick=0.7,      # Moderate speed
        stealth_detection_range=8.0,    # Visible when deceiving
        mcts_allocation=0.3,            # 30% for prediction of player behavior
        ppo_aggression_factor=0.6,      # Balanced aggression
        territory_bounds=(15, 22, 6, 8)  # Nursery/Old Morgue area
    ),
    AgentRole.CONDUCTOR: RoleConstraints(
        max_engagement_distance=20.0,  # Strategic oversight
        min_patience_ticks=60,         # Long-term planning
        max_movement_per_tick=0.3,     # Very slow, mostly stationary
        stealth_detection_range=20.0,   # Always visible (system console)
        mcts_allocation=0.8,           # 80% for strategic planning
        ppo_aggression_factor=0.1,     # Minimal direct movement
        territory_bounds=(25, 27, 1, 4)  # Research Chamber/The Void
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
    patience_timer: int = 0   # For role-based patience
    stealth_ticks: int = 0    # For ghost stealth tracking
    search_timer: int = 180   # Countdown while in SEARCH state (initialized)
    wait_timer: int = 0       # Countdown while in WAIT state
    
    # AI components
    ppo_network: Optional[PPONetwork] = None
    belief_state: Optional[BeliefState] = None
    constraints: Optional[RoleConstraints] = None
    gaslighter: Optional[Gaslighter] = None  # Gaslighter deception module
    conductor: Optional[Conductor] = None  # Conductor orchestrator (only for agent 4)


# ── Swarm Manager ────────────────────────────────────────────────────────────────

class SwarmManager:
    """Manages the entire swarm of Stalkers with strategic spawning."""
    
    def __init__(self, config: StalkerConfig, difficulty: DifficultyMode = DifficultyMode.NORMAL):
        self.config = config
        self.difficulty = difficulty
        self.stalkers: List[Stalker] = []
        self.commnet = CommNet(config, num_agents=5)
        self.swarm_mcp = SwarmMCP(config, num_agents=5)
        self.conductor: Optional[Conductor] = None
        self.player_keys_collected: int = 0
        self.dynamic_spawn_enabled: bool = True
        
    def spawn_swarm(self) -> List[Stalker]:
        """Spawn stalkers based on difficulty mode with 5-agent swarm."""
        spawn_configs = self._get_spawn_configuration()
        
        self.stalkers = []
        for i, (zone_id, role) in enumerate(spawn_configs):
            zone = ZONES.get(zone_id, Zone(zone_id, f"Zone {zone_id}", 10 + zone_id, 5))
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
            
            # Initialize role-specific components
            if role == AgentRole.GASLIGHTER:
                stalker.gaslighter = Gaslighter(self.config, i)
            elif role == AgentRole.CONDUCTOR:
                stalker.conductor = Conductor(self.config, num_agents=5)
                self.conductor = stalker.conductor  # Global reference
            
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
            # Full 5-Agent Swarm Configuration
            return [
                (28, AgentRole.ARCHITECT),  # Research Chamber - The Architect
                (10, AgentRole.HOUND),       # Basement - The Hound
                (26, AgentRole.GHOST),       # Hall of Mirrors - The Ghost
                (18, AgentRole.GASLIGHTER),  # Nursery - The Gaslighter
                (29, AgentRole.CONDUCTOR),   # The Void - The Conductor
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
        elif role == AgentRole.GASLIGHTER:
            return self.config.BASE_SPEED * 0.7
        elif role == AgentRole.CONDUCTOR:
            return self.config.BASE_SPEED * 0.3
        return self.config.BASE_SPEED
    
    def _get_role_sight_range(self, role: AgentRole) -> float:
        """Get sight range based on role."""
        if role == AgentRole.ARCHITECT:
            return self.config.BASE_SIGHT_RANGE * 1.5  # Strategic vision
        elif role == AgentRole.HOUND:
            return self.config.BASE_SIGHT_RANGE * 1.2  # Focused vision
        elif role == AgentRole.GHOST:
            return self.config.BASE_SIGHT_RANGE * 0.8  # Tunnel vision
        elif role == AgentRole.GASLIGHTER:
            return self.config.BASE_SIGHT_RANGE * 1.0  # Normal vision for deception
        elif role == AgentRole.CONDUCTOR:
            return self.config.BASE_SIGHT_RANGE * 2.0  # Global oversight
        return self.config.BASE_SIGHT_RANGE
    
    def _get_role_hearing_range(self, role: AgentRole) -> float:
        """Get hearing range based on role."""
        if role == AgentRole.ARCHITECT:
            return self.config.BASE_HEARING_RANGE * 1.3  # Strategic hearing
        elif role == AgentRole.HOUND:
            return self.config.BASE_HEARING_RANGE * 1.5  # Acute hearing
        elif role == AgentRole.GHOST:
            return self.config.BASE_HEARING_RANGE * 0.7  # Selective hearing
        elif role == AgentRole.GASLIGHTER:
            return self.config.BASE_HEARING_RANGE * 1.0  # Normal hearing
        elif role == AgentRole.CONDUCTOR:
            return self.config.BASE_HEARING_RANGE * 2.0  # Global hearing
        return self.config.BASE_HEARING_RANGE
    
    def _get_role_sight_cone(self, role: AgentRole) -> float:
        """Get sight cone based on role."""
        if role == AgentRole.ARCHITECT:
            return self.config.BASE_SIGHT_CONE * 1.5  # Wide strategic view
        elif role == AgentRole.HOUND:
            return self.config.BASE_SIGHT_CONE * 0.8  # Focused pursuit
        elif role == AgentRole.GHOST:
            return self.config.BASE_SIGHT_CONE * 0.5  # Narrow ambush view
        elif role == AgentRole.GASLIGHTER:
            return self.config.BASE_SIGHT_CONE * 1.2  # Wide view for deception
        elif role == AgentRole.CONDUCTOR:
            return math.pi  # 360-degree view (global oversight)
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
        
        # Update Conductor first (orchestrator)
        if self.conductor:
            self._update_conductor(player, tick)
        
        # Update each stalker
        for stalker in self.stalkers:
            # Update belief state from CommNet
            stalker.belief_state = self.commnet.receive_belief(stalker.id, tick)
            
            # Query Oracle Resource for environmental delta
            agent_positions = {s.id: (int(s.x), int(s.y)) for s in self.stalkers}
            env_delta = self.swarm_mcp.get_environmental_delta(
                stalker.id,
                self._get_zone_from_position(stalker.x, stalker.y),
                (player['x'], player['y']),
                agent_positions
            )
            
            # Store bottleneck state in belief metadata
            stalker.belief_state.metadata["bottleneck_state"] = env_delta.bottleneck_state
            stalker.belief_state.metadata["entropy_vector"] = env_delta.entropy_vector
            
            # Read from Shared Attention Buffer for cross-agent awareness
            attention_entries = self.swarm_mcp.read_attention(stalker.id)
            
            # React to attention entries
            for entry in attention_entries:
                if entry.event_type == "deception_success" and stalker.role == AgentRole.GHOST:
                    # Ghost triggers ambush when Gaslighter succeeds
                    if entry.zone_id == 18:  # Nursery
                        stalker.target_x = float(ZONES[18].x)
                        stalker.target_y = float(ZONES[18].y)
                        stalker.state = StalkerState.AMBUSH
                elif entry.event_type == "player_sighting" and stalker.role == AgentRole.HOUND:
                    # Hound chases when player is sighted
                    if entry.confidence > 0.8:
                        stalker.state = StalkerState.PURSUE
            
            # Role-specific updates
            if stalker.role == AgentRole.GASLIGHTER and stalker.gaslighter:
                self._update_gaslighter(stalker, player, tick, tile_at_func)
            
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
                self.commnet.broadcast_belief(
                    stalker.id, 
                    stalker.belief_state, 
                    tick, 
                    sender_role=stalker.role.value
                )
            
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
    
    def _get_zone_from_position(self, x: float, y: float) -> int:
        """Get zone ID from position."""
        # Find closest zone
        closest_zone = 0
        min_dist = float('inf')
        
        for zone_id, zone in ZONES.items():
            dist = math.sqrt((x - zone.x)**2 + (y - zone.y)**2)
            if dist < min_dist:
                min_dist = dist
                closest_zone = zone_id
        
        return closest_zone
    
    def _update_gaslighter(self, stalker: Stalker, player: Dict, tick: int, tile_at_func):
        """Update Gaslighter's deception mechanics."""
        gaslighter = stalker.gaslighter
        if not gaslighter:
            return
        
        # Update all deception mechanics
        gaslighter.update_deception(tick)
        
        # Generate phantom signals periodically
        if tick % 60 == 0:  # Every second
            real_positions = [(s.x, s.y) for s in self.stalkers if s.id != stalker.id]
            player_pos = (player['x'], player['y'])
            
            # Generate phantom in a zone away from real stalkers
            target_zone = random.choice([14, 15, 18])  # Wine Cellar, Old Morgue, Nursery
            phantom = gaslighter.generate_phantom_signal(
                real_positions,
                player_pos,
                target_zone
            )
            gaslighter.phantom_signals.append(phantom)
            
            # Write to Shared Attention Buffer when deception succeeds
            if phantom.intensity > 0.7:
                self.swarm_mcp.write_attention(
                    stalker.id,
                    target_zone,
                    "deception_success",
                    phantom.intensity,
                    ttl=120
                )
        
        # Activate observation mask in high-stakes zones
        if tick % 300 == 0:  # Every 5 seconds
            high_stakes_zones = [26, 28]  # Hall of Mirrors, Research Chamber
            target_zone = random.choice(high_stakes_zones)
            gaslighter.activate_observation_mask(target_zone, tick)
            
            # Update heatmap for the zone
            self.swarm_mcp.update_heatmap(target_zone, 0.9)
        
        # Tile swap trap-door for shortcuts
        if tick % 180 == 0:  # Every 3 seconds
            # Swap a tile near player's expected path
            if stalker.known_player_position:
                swap_pos = (
                    stalker.known_player_position[0] + random.randint(-2, 2),
                    stalker.known_player_position[1] + random.randint(-2, 2)
                )
                # Make door look like wall
                gaslighter.swap_tile_metadata(swap_pos, 1, duration=60)
    
    def _update_conductor(self, player: Dict, tick: int):
        """Update Conductor's hierarchical meta-RL orchestration with SwarmMCP."""
        if not self.conductor:
            return
        
        # Update active options
        instructions = self.conductor.update_options(tick)
        
        # Apply instructions to agents using atomic commands
        for instr in instructions:
            agent_id = instr['agent_id']
            if agent_id < len(self.stalkers):
                stalker = self.stalkers[agent_id]
                
                # Apply option parameters
                if 'target_zone' in instr['parameters']:
                    zone_id = instr['parameters']['target_zone']
                    zone = ZONES.get(zone_id, Zone(zone_id, f"Zone {zone_id}", 10 + zone_id, 5))
                    stalker.target_x = float(zone.x)
                    stalker.target_y = float(zone.y)
                
                # Issue atomic command via SwarmMCP for zero-desync
                command_name = instr['option']
                if command_name == "INITIATE_PINCER_BALLROOM":
                    self.swarm_mcp.issue_atomic_command("INITIATE_PINCER", instr['target_agent_ids'])
                elif command_name == "GASLIGHT_HALL_OF_MIRRORS":
                    self.swarm_mcp.issue_atomic_command("GASLIGHT_ZONE", instr['target_agent_ids'])
                elif command_name == "GHOST_AMBUSH_NURSERY":
                    self.swarm_mcp.issue_atomic_command("GHOST_AMBUSH", instr['target_agent_ids'])
        
        # Evaluate new options if idle
        if self.conductor.traceback_fsm_state == "IDLE" and tick % 120 == 0:
            player_pos = (player['x'], player['y'])
            candidates = self.conductor.evaluate_options(tick, player_pos)
            
            # Commit to best option
            if candidates:
                best_option = max(candidates, key=lambda o: o.confidence)
                self.conductor.commit_to_option(best_option)
        
        # Calculate player entropy for strategy adaptation
        if hasattr(self, '_player_position_history'):
            self._player_position_history.append((player['x'], player['y']))
            if len(self._player_position_history) > 10:
                self._player_position_history.pop(0)
                self.conductor.calculate_player_entropy(self._player_position_history)
        else:
            self._player_position_history = [(player['x'], player['y'])]
        
        # Subscribe agents to relevant zones based on Oracle Resource
        for stalker in self.stalkers:
            if stalker.role == AgentRole.GHOST:
                # Ghost subscribes to Nursery (18) for ambush opportunities
                self.swarm_mcp.subscribe_heatmap(stalker.id, 18)
            elif stalker.role == AgentRole.ARCHITECT:
                # Architect subscribes to Research Chamber (28)
                self.swarm_mcp.subscribe_heatmap(stalker.id, 28)
    
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
    'VIL2CCommNet',
    'BeliefState',
    'VoIMessage',
    'NetworkSlice',
    'A2AProtocol',
    'MCPContext',
    'VoICalculator',
    'ProgressiveReceiver',
    'EnvironmentalDelta',
    'AtomicCommand',
    'AttentionEntry',
    'SharedAttentionBuffer',
    'BinaryProtocol',
    'OracleResource',
    'SwarmMCP',
    'Gaslighter',
    'Conductor',
    'PhantomSignal',
    'Option',
    'create_stalker_ai',
    'create_stalker_ai_custom',
    'ZONES',
    # 2026 Conductor AI exports
    'ConductorConfig',
    'GoalType',
    'SubPolicy',
    'ConductorAgentRole',
    'HighLevelGoal',
    'TemporalCreditAssignment',
    'AgentIntention',
    'PriorityNegotiation',
    'LeaderAssignment',
    'LeaderFollowingSystem',
    'SubPolicyAssignment',
    'GoalPartitioning',
    'RewardMixingResult',
    'QMIXRewardMixing',
    'Conflict',
    'ConflictResolution',
]
