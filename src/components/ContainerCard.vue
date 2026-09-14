<script setup lang="ts">
import { computed, ref } from "vue";
import type { ContainerInst, Placement } from "../types";
import { clamp, dgColor } from "../data";
import { COG_WARN_PCT, containerStats } from "../packer";
import { useLoadStore } from "../store";

const props = defineProps<{ inst: ContainerInst }>();
const store = useLoadStore();

const type = computed(() => store.typeById(props.inst.typeId));
const placements = computed(() =>
  store.placements.filter((p) => p.containerId === props.inst.id),
);
const view = computed(() =>
  placements.value
    .map((p) => ({ p, cargo: store.cargoMap.get(p.cargoId) }))
    .filter((v): v is { p: Placement; cargo: NonNullable<typeof v.cargo> } => Boolean(v.cargo)),
);
const stats = computed(() =>
  type.value ? containerStats(type.value, placements.value, store.cargoMap) : null,
);
const cogWarn = computed(() => {
  const s = stats.value;
  if (!s || !s.cog) return false;
  return Math.abs(s.offXPct) > COG_WARN_PCT || Math.abs(s.offYPct) > COG_WARN_PCT;
});

const gridXs = computed(() => {
  if (!type.value) return [];
  const xs: number[] = [];
  for (let x = 100; x < type.value.L; x += 100) xs.push(x);
  return xs;
});

const nameFont = computed(() => (type.value ? type.value.W * 0.075 : 16));
const subFont = computed(() => (type.value ? type.value.W * 0.055 : 12));
const cogR = computed(() => (type.value ? type.value.W * 0.028 : 6));

function showLabel(p: Placement): boolean {
  if (!type.value) return false;
  return p.dx >= type.value.L * 0.09 && p.dy >= type.value.W * 0.2;
}

// ---------- 拖动 ----------
const svgEl = ref<SVGSVGElement | null>(null);
const dragId = ref<string | null>(null);
const dragDx = ref(0);
const dragDy = ref(0);
const ghostX = ref(0);
const ghostY = ref(0);
let grabDX = 0;
let grabDY = 0;

function toContainer(e: PointerEvent): { x: number; y: number } {
  const svg = svgEl.value;
  if (!svg) return { x: 0, y: 0 };
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  return { x: pt.x, y: pt.y };
}

function onDown(p: Placement, e: PointerEvent) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  e.preventDefault();
  const c = toContainer(e);
  grabDX = c.x - p.x;
  grabDY = c.y - p.y;
  dragId.value = p.cargoId;
  dragDx.value = p.dx;
  dragDy.value = p.dy;
  ghostX.value = p.x;
  ghostY.value = p.y;
}

function onMove(e: PointerEvent) {
  if (!dragId.value || !type.value) return;
  const c = toContainer(e);
  ghostX.value = clamp(c.x - grabDX, 0, type.value.L - dragDx.value);
  ghostY.value = clamp(c.y - grabDY, 0, type.value.W - dragDy.value);
}

function onUp() {
  if (!dragId.value) return;
  const id = dragId.value;
  const x = Math.round(ghostX.value);
  const y = Math.round(ghostY.value);
  dragId.value = null;
  store.moveCargo(id, x, y);
}

function onTransfer(cargoId: string, e: Event) {
  const target = (e.target as HTMLSelectElement).value;
  if (target) store.transferCargo(cargoId, target);
}
</script>

<template>
  <article v-if="type" class="container-card" :class="{ warn: cogWarn }">
    <header class="cc-head">
      <div>
        <strong>{{ inst.name }}</strong>
        <span class="tag">{{ type.name }}</span>
        <span class="dim">{{ type.L }}×{{ type.W }}×{{ type.H }} cm · 限重 {{ type.payload }} kg</span>
      </div>
      <span v-if="cogWarn" class="badge warn">⚠ 重心偏移过大</span>
    </header>

    <div class="bars" v-if="stats">
      <div class="ubar">
        <span>体积利用率 {{ stats.volumePct.toFixed(1) }}%（{{ (stats.volume / 1e6).toFixed(2) }} m³）</span>
        <div class="track"><div class="fill" :style="{ width: stats.volumePct + '%' }" /></div>
      </div>
      <div class="ubar">
        <span>载重利用率 {{ stats.weightPct.toFixed(1) }}%（{{ stats.weight }} kg）</span>
        <div class="track"><div class="fill weight" :style="{ width: stats.weightPct + '%' }" /></div>
      </div>
      <p v-if="stats.cog" class="cog-line">
        重心：纵向 {{ Math.round(stats.cog.x) }}cm / 横向 {{ Math.round(stats.cog.y) }}cm / 高度
        {{ Math.round(stats.cog.z) }}cm（偏移 {{ stats.offXPct.toFixed(1) }}% /
        {{ stats.offYPct.toFixed(1) }}%，限 ±{{ COG_WARN_PCT }}%）
      </p>
    </div>

    <svg
      ref="svgEl"
      class="topview"
      :viewBox="`0 0 ${type.L} ${type.W}`"
      preserveAspectRatio="xMidYMid meet"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointerleave="onUp"
    >
      <rect x="0" y="0" :width="type.L" :height="type.W" class="floor" />
      <line
        v-for="x in gridXs"
        :key="x"
        :x1="x"
        y1="0"
        :x2="x"
        :y2="type.W"
        class="grid"
      />
      <g v-for="v in view" :key="v.p.cargoId">
        <rect
          :x="v.p.x"
          :y="v.p.y"
          :width="v.p.dx"
          :height="v.p.dy"
          rx="4"
          class="cargo-rect"
          :class="{
            conflict: store.conflictIds.includes(v.p.cargoId),
            dragging: dragId === v.p.cargoId,
          }"
          :fill="dgColor(v.cargo.dgClass)"
          @pointerdown="onDown(v.p, $event)"
        >
          <title>
            {{ v.cargo.name }} · {{ v.p.dx }}×{{ v.p.dy }}×{{ v.p.dz }}cm ·
            {{ v.cargo.weight }}kg · z={{ v.p.z }}cm
          </title>
        </rect>
        <template v-if="showLabel(v.p)">
          <text
            :x="v.p.x + v.p.dx / 2"
            :y="v.p.y + v.p.dy / 2 - subFont * 0.2"
            :font-size="nameFont"
            class="cargo-label"
          >
            {{ v.cargo.name }}
          </text>
          <text
            :x="v.p.x + v.p.dx / 2"
            :y="v.p.y + v.p.dy / 2 + subFont * 1.1"
            :font-size="subFont"
            class="cargo-label sub"
          >
            z={{ v.p.z }} · {{ v.cargo.weight }}kg
          </text>
        </template>
      </g>
      <rect
        v-if="dragId"
        :x="ghostX"
        :y="ghostY"
        :width="dragDx"
        :height="dragDy"
        rx="4"
        class="ghost"
      />
      <g v-if="stats && stats.cog" class="cog-marker">
        <line :x1="stats.cog.x - cogR * 1.8" :y1="stats.cog.y" :x2="stats.cog.x + cogR * 1.8" :y2="stats.cog.y" />
        <line :x1="stats.cog.x" :y1="stats.cog.y - cogR * 1.8" :x2="stats.cog.x" :y2="stats.cog.y + cogR * 1.8" />
        <circle :cx="stats.cog.x" :cy="stats.cog.y" :r="cogR" />
      </g>
    </svg>
    <p class="hint">俯视图（⊕ 为重心）。拖动货物可调整位置，违反约束的移动将被拒绝并高亮冲突货物。</p>

    <ul class="placement-list">
      <li v-for="v in view" :key="v.p.cargoId" :class="{ conflict: store.conflictIds.includes(v.p.cargoId) }">
        <span class="pl-name">{{ v.cargo.name }}</span>
        <span class="pl-dim">
          {{ v.p.dx }}×{{ v.p.dy }}×{{ v.p.dz }} @ ({{ v.p.x }}, {{ v.p.y }}, {{ v.p.z }})
        </span>
        <span class="pl-actions">
          <button
            v-if="v.cargo.rotation !== 'none'"
            class="secondary sm"
            type="button"
            @click="store.rotateCargo(v.p.cargoId)"
          >
            旋转90°
          </button>
          <select
            :value="v.p.containerId"
            title="换箱"
            @change="onTransfer(v.p.cargoId, $event)"
          >
            <option v-for="c in store.containers" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </span>
      </li>
    </ul>
  </article>
</template>
