<script setup lang="ts">
import { computed } from "vue";
import { useLoadStore } from "../store";
import { DG_CLASSES, ROTATION_MODES, dgColor } from "../data";
import type { DgClass, RotationMode } from "../types";

const store = useLoadStore();

const rows = computed(() =>
  store.cargos.map((cargo) => ({
    cargo,
    containerName: store.containerNameOf(cargo.id),
    reason: store.unplacedReasons[cargo.id],
  })),
);

function rotationLabel(id: RotationMode): string {
  return ROTATION_MODES.find((m) => m.id === id)?.label ?? id;
}

function dgName(id: DgClass): string {
  return DG_CLASSES.find((d) => d.id === id)?.label ?? id;
}
</script>

<template>
  <section class="panel">
    <div class="toolbar">
      <h2>货物清单（{{ store.cargos.length }} 件）</h2>
      <span v-if="store.unplacedCargos.length" class="badge warn">
        {{ store.unplacedCargos.length }} 件未装箱
      </span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>货物</th>
            <th>尺寸(cm)</th>
            <th>重量(kg)</th>
            <th>旋转</th>
            <th>危险品</th>
            <th>堆码承重</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!rows.length">
            <td colspan="8" class="empty">暂无货物，请先录入</td>
          </tr>
          <tr
            v-for="row in rows"
            :key="row.cargo.id"
            :class="{ conflict: store.conflictIds.includes(row.cargo.id) }"
          >
            <td class="name">{{ row.cargo.name }}</td>
            <td>{{ row.cargo.length }}×{{ row.cargo.width }}×{{ row.cargo.height }}</td>
            <td>{{ row.cargo.weight }}</td>
            <td>{{ rotationLabel(row.cargo.rotation) }}</td>
            <td>
              <span class="dg-dot" :style="{ background: dgColor(row.cargo.dgClass) }" />
              {{ dgName(row.cargo.dgClass) }}
            </td>
            <td>{{ row.cargo.stackLimit > 0 ? row.cargo.stackLimit : "不可堆压" }}</td>
            <td>
              <span v-if="row.containerName" class="badge ok">{{ row.containerName }}</span>
              <span v-else class="badge warn" :title="row.reason">
                未装箱{{ row.reason ? `：${row.reason}` : "" }}
              </span>
            </td>
            <td>
              <button class="danger sm" type="button" @click="store.removeCargo(row.cargo.id)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
