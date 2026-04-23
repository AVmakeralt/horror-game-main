// ── Enhanced Art System ───────────────────────────────────────────────────────
// Improved visual rendering with gradients, lighting, and atmospheric effects

// Color palette - carefully selected for horror atmosphere
const PALETTE = {
  // Walls
  wallDark: "#1a1520",
  wallMid: "#2a2030",
  wallLight: "#3a3050",
  wallPurple: "#2a1742",
  wallTeal: "#1a3a40",
  
  // Floors
  floorDark: "#151015",
  floorMid: "#252030",
  floorLight: "#353040",
  floorWood: "#3d2f28",
  floorStone: "#2a2a30",
  
  // Accents
  exitGreen: "#5fa060",
  fakeExit: "#7fa060",
  mirror: "#6b5a8a",
  acid: "#3a6a20",
  ritual: "#5a2030",
  
  // Lighting
  shadow: "rgba(0,0,0,0.4)",
  lightWarm: "rgba(255,200,100,0.3)",
  lightCool: "rgba(100,180,255,0.2)",
  lightFlicker: "rgba(255,255,200,0.1)",
  
  // UI
  uiDark: "rgba(10,8,14,0.85)",
  uiLight: "rgba(200,190,180,0.9)",
};

// Gradient generators for atmospheric depth
class GradientFactory {
  constructor(ctx) {
    this.ctx = ctx;
  }
  
  // Wall gradient with atmospheric perspective
  wallGradient(x, y, w, h, type = "default") {
    const grad = this.ctx.createLinearGradient(x, y, x, y + h);
    
    switch (type) {
      case "entrance":
        grad.addColorStop(0, "#3d2f28");
        grad.addColorStop(0.5, "#2a2018");
        grad.addColorStop(1, "#1a1510");
        break;
      case "bedroom":
        grad.addColorStop(0, "#33413a");
        grad.addColorStop(0.5, "#25302a");
        grad.addColorStop(1, "#1a2018");
        break;
      case "bathroom":
        grad.addColorStop(0, "#2f3a44");
        grad.addColorStop(0.5, "#1f2a34");
        grad.addColorStop(1, "#0f1a24");
        break;
      case "laboratory":
        grad.addColorStop(0, "#2a2a40");
        grad.addColorStop(0.5, "#1a1a30");
        grad.addColorStop(1, "#0a0a20");
        break;
      default:
        grad.addColorStop(0, PALETTE.wallMid);
        grad.addColorStop(0.5, PALETTE.wallDark);
        grad.addColorStop(1, "#0a0510");
    }
    return grad;
  }
  
  // Floor gradient
  floorGradient(x, y, w, h) {
    const grad = this.ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, PALETTE.floorMid);
    grad.addColorStop(0.5, PALETTE.floorDark);
    grad.addColorStop(1, "#0a0508");
    return grad;
  }
  
  // Vignette for corners
  vignette(x, y, w, h, intensity = 0.5) {
    const grad = this.ctx.createRadialGradient(
      x + w/2, y + h/2, 0,
      x + w/2, y + h/2, Math.max(w, h)
    );
    grad.addColorStop(0, `rgba(0,0,0,0)`);
    grad.addColorStop(0.7, `rgba(0,0,0,${intensity * 0.3})`);
    grad.addColorStop(1, `rgba(0,0,0,${intensity})`);
    return grad;
  }
  
  // Light source glow
  lightGlow(x, y, radius, color = PALETTE.lightWarm) {
    const grad = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
    const baseColor = color.replace(/[\d.]+\)$/, "0)");
    grad.addColorStop(0, color);
    grad.addColorStop(0.5, color.replace("0.3", "0.1"));
    grad.addColorStop(1, baseColor);
    return grad;
  }
}

// Enhanced tile renderer
class TileRenderer {
  constructor(ctx, TILE) {
    this.ctx = ctx;
    this.TILE = TILE;
    this.gradients = new GradientFactory(ctx);
  }
  
  // Draw enhanced tile with depth
  drawTile(x, y, t, tick) {
    const bx = x * this.TILE;
    const by = y * this.TILE;
    const TILE = this.TILE;
    
    // Base tile rendering with gradients
    this.drawTileBase(bx, by, t, TILE);
    
    // Add depth effects
    this.drawTileDepth(bx, by, t, TILE, tick);
    
    // Add special effects based on tile type
    this.drawTileEffects(bx, by, t, TILE, tick, x, y);
  }
  
  // Draw base tile colors with gradients
  drawTileBase(bx, by, t, TILE) {
    const ctx = this.ctx;
    
    // Create gradient fill for depth
    const grad = ctx.createLinearGradient(bx, by, bx, by + TILE);
    
    switch (t) {
      case 0: // Floor
        grad.addColorStop(0, "#1a1020");
        grad.addColorStop(0.5, "#150815");
        grad.addColorStop(1, "#0f0510");
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, TILE, TILE);
        break;
        
      case 1: // Wall - enhanced with gradient
        grad.addColorStop(0, "#3a2048");
        grad.addColorStop(0.5, "#2a1538");
        grad.addColorStop(1, "#1a0a28");
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, TILE, TILE);
        
        // Add wall texture
        ctx.fillStyle = "rgba(80,50,100,0.15)";
        for (let i = 4; i < TILE; i += 12) {
          ctx.fillRect(bx + 2, by + i, TILE - 4, 2);
        }
        break;
        
      case 2: // Hide spot
        grad.addColorStop(0, "#4a4070");
        grad.addColorStop(1, "#2a2040");
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, TILE, TILE);
        break;
        
      case 3: // Ink
        grad.addColorStop(0, "#663350");
        grad.addColorStop(1, "#3a1a30");
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, TILE, TILE);
        break;
        
      case 4: // Corruption
        grad.addColorStop(0, "#208070");
        grad.addColorStop(0.5, "#105850");
        grad.addColorStop(1, "#083830");
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, TILE, TILE);
        break;
        
      case 5: // Exit
        grad.addColorStop(0, "#60b070");
        grad.addColorStop(0.5, "#408050");
        grad.addColorStop(1, "#205030");
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, TILE, TILE);
        
        // Glowing exit effect
        const exitGlow = ctx.createRadialGradient(
          bx + TILE/2, by + TILE/2, 0,
          bx + TILE/2, by + TILE/2, TILE/2
        );
        exitGlow.addColorStop(0, "rgba(100,255,100,0.3)");
        exitGlow.addColorStop(1, "rgba(100,255,100,0)");
        ctx.fillStyle = exitGlow;
        ctx.fillRect(bx, by, TILE, TILE);
        break;
        
      case 11: // Mirror
        grad.addColorStop(0, "#7a6aa0");
        grad.addColorStop(0.5, "#5a4a80");
        grad.addColorStop(1, "#3a2a60");
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, TILE, TILE);
        
        // Mirror reflection shimmer
        ctx.fillStyle = "rgba(200,200,255,0.2)";
        ctx.fillRect(bx + 8, by + 8, TILE - 16, 4);
        ctx.fillRect(bx + 12, by + 20, TILE - 24, 2);
        break;
        
      case 16: // Fake exit
        grad.addColorStop(0, "#80a060");
        grad.addColorStop(0.5, "#608040");
        grad.addColorStop(1, "#406020");
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, TILE, TILE);
        
        // Subtle wrongness indicator
        ctx.fillStyle = "rgba(200,50,50,0.08)";
        ctx.fillRect(bx, by, TILE, 2);
        ctx.fillRect(bx, by + TILE - 2, TILE, 2);
        break;
        
      case 18: // Acid
        grad.addColorStop(0, "#2a5a10");
        grad.addColorStop(0.5, "#1a4a08");
        grad.addColorStop(1, "#0a3a00");
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, TILE, TILE);
        break;
        
      case 19: // Ritual
        grad.addColorStop(0, "#5a2040");
        grad.addColorStop(0.5, "#3a1028");
        grad.addColorStop(1, "#1a0518");
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, TILE, TILE);
        break;
        
      default:
        ctx.fillStyle = "#18031f";
        ctx.fillRect(bx, by, TILE, TILE);
    }
  }
  
  // Add depth and shadow effects
  drawTileDepth(bx, by, t, TILE, tick) {
    const ctx = this.ctx;
    
    // Shadow for walls
    if (t === 1) {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(bx, by + TILE - 8, TILE, 8);
    }
    
    // Floor ambient occlusion
    if (t === 0) {
      // Corner shadows
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(bx, by, 4, TILE);
      ctx.fillRect(bx + TILE - 4, by, 4, TILE);
      ctx.fillRect(bx, by + TILE - 4, TILE, 4);
    }
  }
  
  // Special effects for specific tiles
  drawTileEffects(bx, by, t, TILE, tick, x, y) {
    const ctx = this.ctx;
    
    // Acid bubbling effect
    if (t === 18) {
      const bubblePhase = (tick + x * 10 + y * 5) % 60;
      if (bubblePhase < 20) {
        const alpha = (20 - bubblePhase) / 20;
        ctx.fillStyle = `rgba(100,255,50,${alpha * 0.5})`;
        const size = 4 + (bubblePhase / 10);
        ctx.beginPath();
        ctx.arc(bx + 16, by + 20, size, 0, Math.PI * 2);
        ctx.fill();
      }
      if (bubblePhase > 30 && bubblePhase < 50) {
        const alpha = (50 - bubblePhase) / 20;
        ctx.fillStyle = `rgba(100,255,50,${alpha * 0.3})`;
        ctx.beginPath();
        ctx.arc(bx + 40, by + 35, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    
    // Ritual circle pulsing
    if (t === 19) {
      const pulse = 0.5 + 0.3 * Math.sin(tick * 0.05);
      ctx.strokeStyle = `rgba(200,50,100,${pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx + TILE/2, by + TILE/2, 20, 0, Math.PI * 2);
      ctx.stroke();
      
      // Inner circle
      ctx.strokeStyle = `rgba(150,30,80,${pulse * 0.3})`;
      ctx.beginPath();
      ctx.arc(bx + TILE/2, by + TILE/2, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Mirror shimmer
    if (t === 11) {
      const shimmer = (tick + x * 20 + y * 10) % 100;
      if (shimmer < 30) {
        const alpha = (30 - shimmer) / 30 * 0.3;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillRect(bx + 8, by + 12, TILE - 16, 8);
      }
    }
    
    // Exit glow pulse
    if (t === 5) {
      const pulse = 0.6 + 0.2 * Math.sin(tick * 0.08);
      ctx.fillStyle = `rgba(100,255,100,${pulse * 0.15})`;
      ctx.fillRect(bx - 2, by - 2, TILE + 4, TILE + 4);
    }
  }
}

// Lighting system
class LightingSystem {
  constructor(ctx, canvas, TILE) {
    this.ctx = ctx;
    this.canvas = canvas;
    this.TILE = TILE;
    this.lights = [];
  }
  
  // Add a light source
  addLight(x, y, radius, color, intensity = 1) {
    this.lights.push({ x, y, radius, color, intensity });
  }
  
  // Clear all lights
  clear() {
    this.lights = [];
  }
  
  // Render lighting overlay
  render(playerX, playerY, flashlightEnabled, tick) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    // Create lighting layer
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    
    // Base darkness
    ctx.fillStyle = "rgba(10,5,20,0.7)";
    ctx.fillRect(0, 0, w, h);
    
    // Player flashlight
    if (flashlightEnabled) {
      this.drawFlashlight(playerX, playerY, tick);
    }
    
    // Render all light sources
    ctx.globalCompositeOperation = "screen";
    for (const light of this.lights) {
      this.drawLightSource(light);
    }
    
    ctx.restore();
  }
  
  // Draw flashlight beam
  drawFlashlight(px, py, tick) {
    const ctx = this.ctx;
    const x = px * this.TILE + this.TILE/2;
    const y = py * this.TILE + this.TILE/2;
    const radius = 180;
    
    // Flicker effect
    const flicker = 0.9 + 0.1 * Math.sin(tick * 0.2) + 0.05 * Math.random();
    
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, `rgba(255,240,200,${0.4 * flicker})`);
    grad.addColorStop(0.5, `rgba(255,220,150,${0.2 * flicker})`);
    grad.addColorStop(1, "rgba(255,200,100,0)");
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Draw individual light source
  drawLightSource(light) {
    const ctx = this.ctx;
    const x = light.x * this.TILE + this.TILE/2;
    const y = light.y * this.TILE + this.TILE/2;
    
    const grad = ctx.createRadialGradient(x, y, 0, x, y, light.radius);
    grad.addColorStop(0, light.color.replace(/[\d.]+\)$/, `${light.intensity})`));
    grad.addColorStop(0.5, light.color.replace(/[\d.]+\)$/, `${light.intensity * 0.5})`));
    grad.addColorStop(1, light.color.replace(/[\d.]+\)$/, "0)"));
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, light.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Particle system for atmospheric effects
class ParticleSystem {
  constructor(ctx, canvas) {
    this.ctx = ctx;
    this.canvas = canvas;
    this.particles = [];
  }
  
  // Add particle
  addParticle(x, y, type, options = {}) {
    this.particles.push({
      x, y,
      vx: options.vx || 0,
      vy: options.vy || 0,
      life: options.life || 60,
      maxLife: options.life || 60,
      size: options.size || 4,
      color: options.color || "rgba(200,200,200,0.5)",
      type,
    });
  }
  
  // Update and render particles
  updateAndRender() {
    const ctx = this.ctx;
    
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      
      // Update
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      
      // Render
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color.replace(/[\d.]+\)$/, `${alpha})`);
      ctx.fillRect(p.x, p.y, p.size, p.size);
      
      // Remove dead particles
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }
  
  // Spawn ambient particles
  spawnAmbient(count, tick) {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * this.canvas.width;
      const y = Math.random() * this.canvas.height;
      this.addParticle(x, y, "dust", {
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        life: 60 + Math.random() * 60,
        size: 1 + Math.random() * 2,
        color: "rgba(200,180,160,0.3)",
      });
    }
  }
}

// Export
export { PALETTE, GradientFactory, TileRenderer, LightingSystem, ParticleSystem };
