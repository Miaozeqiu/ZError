<template>
  <div style="width: 100%; height: 100%; background-color: #fff; display: flex; align-items: center; justify-content: center;">
    <img :src="iconSrc" style="width: 100%; height: 100%; object-fit: cover;" />
  </div>
</template>

<script>
import iconSrc from './60b9ec66ae5a9ba4024b3e65.webp';

export default {
  name: 'ZhihuizhijiaoIcon',
  data() {
    return {
      iconSrc
    }
  }
}
</script>