<script setup lang="ts">
import { computed } from "vue";
import { useLoadStore } from "./store";
import { CONTAINER_TYPES, DG_CLASSES } from "./data";
import { containerStats } from "./packer";
import CargoForm from "./components/CargoForm.vue";
import CargoTable from "./components/CargoTable.vue";
import ContainerCard from "./components/ContainerCard.vue";

const store = useLoadStore();

const metrics = computed(() => {
  const total = store.cargos.length;
  const placed = store.placements.length;
  const boxes = store.containers.length;
  let volSum = 0;
  let count = 0;
  for (const inst of store.containers) {
    const type = store.typeById(inst.typeId);
    if (!type) continue;
    const s = containerStats(type, store.placementsOf(inst.id), store.cargoMap);
    volSum += s.volumePct;
    count += 1;
  }
  return [
    { label: "货物总数（件）", value: total },
    { label: "已装箱 / 未装箱", value: `${placed} / ${total - placed}` },
    { label: "集装箱数量", value: boxes },
    { label: "平均体积利用率", value: count ? `${(volSum / count).toFixed(1)}%` : "-" },
  ];
});
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流 · 拼箱装载核验</p>
          <h1>集装箱拼箱装载核验台</h1>
          <p class="subtitle">
            录入货物尺寸、重量、可旋转方式与危险品属性，自动分配到多个集装箱并生成俯视装位图；
            支持拖动调整、实时核验体积 / 载重 / 堆码 / 危险品隔离约束，并导出装载清单与各箱利用率。
          </p>
        </div>
        <div class="actions-col">
          <div class="type-picker">
            <span>可用箱型：</span>
            <label v-for="t in CONTAINER_TYPES" :key="t.id" class="check">
              <input v-model="store.allowedTypes" type="checkbox" :value="t.id" />
              {{ t.name }}
            </label>
          </div>
          <div class="btn-row">
            <button type="button" @click="store.runAutoPack()">自动装箱</button>
            <button class="secondary" type="button" @click="store.doExportManifest()">导出装载清单</button>
            <button class="secondary" type="button" @click="store.doExportUtilization()">导出各箱利用率</button>
            <button class="secondary" type="button" @click="store.resetDemo()">重置示例</button>
            <button class="danger" type="button" @click="store.clearAll()">清空数据</button>
          </div>
        </div>
      </header>

      <p v-if="store.notice" class="notice" :class="store.notice.type">{{ store.notice.text }}</p>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <section v-if="store.notes.length" class="panel notes-panel">
        <h2>危险品隔离说明</h2>
        <ul>
          <li v-for="(n, i) in store.notes" :key="i">{{ n }}</li>
        </ul>
      </section>

      <section class="workspace">
        <div class="col">
          <CargoForm />
          <CargoTable />
        </div>
        <div class="col">
          <div class="panel legend">
            <h2>图例（按危险品属性着色）</h2>
            <div class="legend-items">
              <span v-for="d in DG_CLASSES" :key="d.id" class="legend-item">
                <i :style="{ background: d.color }" />{{ d.label }}
              </span>
            </div>
          </div>
          <div v-if="!store.containers.length" class="panel empty-box">
            录入货物后点击「自动装箱」，这里将显示各集装箱的俯视装位图。
          </div>
          <ContainerCard v-for="c in store.containers" :key="c.id" :inst="c" />
        </div>
      </section>
    </div>
  </main>
</template>
