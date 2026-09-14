<script setup lang="ts">
import { reactive } from "vue";
import { useLoadStore } from "../store";
import { DG_CLASSES, ROTATION_MODES } from "../data";
import type { DgClass, RotationMode } from "../types";

const store = useLoadStore();

const form = reactive({
  name: "",
  length: 100,
  width: 80,
  height: 60,
  weight: 50,
  quantity: 1,
  rotation: "horizontal" as RotationMode,
  dgClass: "none" as DgClass,
  stackLimit: 500,
});

function submit() {
  if (!form.name.trim()) return;
  store.addCargo(
    {
      name: form.name.trim(),
      length: form.length,
      width: form.width,
      height: form.height,
      weight: form.weight,
      rotation: form.rotation,
      dgClass: form.dgClass,
      stackLimit: form.stackLimit,
    },
    form.quantity,
  );
  form.name = "";
}
</script>

<template>
  <form class="panel" @submit.prevent="submit">
    <h2>录入货物</h2>
    <div class="form-grid">
      <label>
        货物名称
        <input v-model="form.name" type="text" required placeholder="如：纸箱日用品" />
      </label>
      <div class="triple">
        <label>
          长(cm)
          <input v-model.number="form.length" type="number" min="1" max="2000" required />
        </label>
        <label>
          宽(cm)
          <input v-model.number="form.width" type="number" min="1" max="2000" required />
        </label>
        <label>
          高(cm)
          <input v-model.number="form.height" type="number" min="1" max="300" required />
        </label>
      </div>
      <div class="triple">
        <label>
          重量(kg)
          <input v-model.number="form.weight" type="number" min="0.1" step="0.1" required />
        </label>
        <label>
          数量
          <input v-model.number="form.quantity" type="number" min="1" max="99" required />
        </label>
        <label>
          堆码承重(kg)
          <input v-model.number="form.stackLimit" type="number" min="0" title="允许压在本货物顶部的最大重量，0 表示不可堆压" required />
        </label>
      </div>
      <label>
        可旋转方式
        <select v-model="form.rotation">
          <option v-for="m in ROTATION_MODES" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
      </label>
      <label>
        危险品属性
        <select v-model="form.dgClass">
          <option v-for="d in DG_CLASSES" :key="d.id" :value="d.id">{{ d.label }}</option>
        </select>
      </label>
      <p class="hint">堆码承重为 0 表示该货物顶部不可再堆压其他货物。</p>
      <button type="submit">录入货物</button>
    </div>
  </form>
</template>
