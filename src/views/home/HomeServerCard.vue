<template>
    <div class="server-control">
      <div class="server-card">
        <div class="server-main-content">
          <div class="server-info">
            <div class="server-icon" :class="{ 'running': serverRunning, 'stopped': !serverRunning }">
            </div>
            <div class="server-details">
              <p class="server-url">
                地址: <a v-if="serverUrl" :href="serverUrl" target="_blank" class="url-link">{{ serverUrl }}</a>
                <span v-else class="url-placeholder">未启动</span>
              </p>
            </div>
          </div>
          <div class="server-config-controls">
            <div class="tooltip-container">
              <button class="config-btn ocs-config" @click="$emit('open-ocs')">
                <svg width="800" height="800" viewBox="0 0 800 800" shape-rendering="geometricPrecision"
                  xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                  <g stroke="null">
                    <g stroke="null">
                      <path stroke="null" opacity="1"
                        d="m382.29066,36c12.1533,0 24.30713,0 36.46043,0c90.68231,5.71443 168.8118,39.84485 234.3885,102.39137c6.51079,6.54676 13.02158,13.09353 19.53237,19.64029c0.3021,0.7479 0.21355,1.44657 -0.26043,2.09496c-43.79419,43.2521 -87.37482,86.81007 -130.7367,130.67338c34.98118,48.09304 44.96613,101.07835 29.94964,158.9554c-2.51056,8.36991 -5.46386,16.57483 -8.85468,24.61583c-11.80641,-11.87164 -23.6123,-23.74275 -35.41871,-35.61439c13.18878,-52.67211 0.77504,-98.15064 -37.24173,-136.43453c-36.96359,-31.76751 -79.15352,-41.71859 -126.56979,-29.85324c-41.61073,13.20927 -70.51864,40.18193 -86.72374,80.91799c-6.98269,18.77193 -9.58701,38.15034 -7.81295,58.13525c1.00631,9.21627 2.5689,18.29427 4.68777,27.23453c-11.63973,11.79151 -23.35916,23.48821 -35.15827,35.09065c-21.92522,-50.63109 -21.49134,-101.08463 1.30216,-151.36115c20.91423,-42.50368 53.29421,-72.44438 97.14101,-89.82158c50.90345,-17.98841 100.38547,-14.67103 148.44605,9.95108c8.21037,4.69377 16.1103,9.84371 23.69928,15.45036c32.46697,-32.64635 64.93603,-65.29322 97.40144,-97.93957c0.34898,-0.34934 0.34898,-0.69815 0,-1.04748c-57.13558,-48.60893 -123.37221,-74.18514 -198.70936,-76.72806c-93.66529,-0.69134 -172.9235,32.56622 -237.77411,99.77266c-68.72219,76.44733 -95.98068,166.00705 -81.77554,268.67914c16.97441,95.0548 65.67514,168.46653 146.10216,220.2331c79.79209,47.47712 164.51937,58.99942 254.1813,34.56691c44.38224,-13.2297 83.96838,-34.87591 118.75684,-64.94389c-10.32872,-10.38578 -20.66265,-20.77681 -30.99137,-31.16259c-59.52895,49.04311 -127.84903,70.08178 -204.95972,63.11079c-60.75662,-6.95528 -113.36382,-31.2202 -157.82159,-72.8c-7.38636,-7.33761 -14.67845,-14.75902 -21.87626,-22.25899c32.81439,-33.34502 65.80223,-66.51511 98.96403,-99.51079c8.08119,8.03838 16.24104,15.98196 24.48058,23.83022c36.73076,29.45415 77.87896,38.00893 123.44461,25.66331c28.33497,-8.68886 51.16649,-25.0123 68.49353,-48.96978c0.55316,-0.73271 1.24747,-1.25645 2.08345,-1.57122c11.09803,10.54814 21.94918,21.37178 32.55396,32.47194c-39.25226,48.79171 -90.29687,71.92535 -153.13382,69.39568c-35.57705,-2.66584 -67.52316,-14.71189 -95.83885,-36.13813c-0.52086,-0.34934 -1.04173,-0.34934 -1.56259,0c-11.28555,11.3479 -22.57057,22.6937 -33.85612,34.04317c57.26267,45.04173 121.67576,60.23022 193.24029,45.56547c35.89634,-8.22797 67.84245,-24.11304 95.83885,-47.66043c10.48029,-9.57922 20.72515,-19.44127 30.73094,-29.59137c31.50702,31.41922 62.93071,62.92748 94.27626,94.53525c0.30731,0.24092 0.65629,0.32996 1.04173,0.26187c0.47399,0.64944 0.56253,1.34601 0.26043,2.09496c-66.483,73.18233 -149.03775,113.8613 -247.67051,122.03166c-16.32021,0 -32.64094,0 -48.96115,0c-106.75354,-9.01358 -193.65074,-55.10279 -260.6921,-138.26763c-48.46769,-63.12127 -74.25041,-134.70095 -77.3482,-214.73381c0,-7.15797 0,-14.31541 0,-21.47338c3.87934,-92.60789 36.95416,-172.74026 99.22446,-240.39712c66.97677,-69.32278 148.66585,-107.03213 245.0662,-113.12806z"
                        fill="currentColor" />
                    </g>
                    <g stroke="null">
                      <path stroke="null" opacity="1"
                        d="m696.37125,191.02734c0.79171,0.00576 1.39591,0.35457 1.82302,1.04748c38.54909,56.84056 59.81594,119.68949 63.80576,188.54676c0,12.91912 0,25.83772 0,38.75683c-4.00544,69.127 -25.44417,132.15086 -64.32662,189.07051c-0.43753,0.78561 -0.86984,0.95845 -1.30216,0.52374c-10.92771,-11.16092 -21.86584,-22.33755 -32.81439,-33.51942c25.06915,-38.32999 41.29925,-80.22927 48.70072,-125.69784c11.92777,-81.28827 -4.30754,-156.27018 -48.70072,-224.94676c11.24544,-11.04308 22.18357,-22.30351 32.81439,-33.7813z"
                        fill="currentColor" />
                    </g>
                  </g>
                </svg>
              </button>
              <span class="tooltip">OCS题库配置</span>
            </div>
            <div class="tooltip-container">
              <button class="config-btn port-config" @click="$emit('configure-port')">
                <svg width="20" height="20" viewBox="0 0 1339 1024" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M1220.923077 0a118.153846 118.153846 0 0 1 118.153846 118.153846v520.822154a118.153846 118.153846 0 0 1-118.153846 118.153846h-91.372308a39.384615 39.384615 0 0 0-33.792 19.180308l-113.664 190.148923A118.153846 118.153846 0 0 1 880.679385 1024H462.296615a118.153846 118.153846 0 0 1-101.572923-57.777231l-112.876307-189.833846a39.384615 39.384615 0 0 0-33.87077-19.298461H118.153846a118.153846 118.153846 0 0 1-118.153846-118.153847V118.153846a118.153846 118.153846 0 0 1 118.153846-118.153846z m0 78.769231H118.153846a39.384615 39.384615 0 0 0-39.384615 39.384615v520.822154a39.384615 39.384615 0 0 0 39.384615 39.384615h95.862154a118.153846 118.153846 0 0 1 101.533538 57.737847l112.876308 189.87323a39.384615 39.384615 0 0 0 33.870769 19.259077H880.64a39.384615 39.384615 0 0 0 33.831385-19.180307l113.624615-190.148924a118.153846 118.153846 0 0 1 101.415385-57.540923H1220.923077a39.384615 39.384615 0 0 0 39.384615-39.384615V118.153846a39.384615 39.384615 0 0 0-39.384615-39.384615zM315.864615 236.307692c22.212923 0 40.172308 17.998769 40.172308 40.172308v77.193846a40.172308 40.172308 0 1 1-80.344615 0V276.48C275.692308 254.306462 293.691077 236.307692 315.864615 236.307692z m235.795693 0c22.173538 0 40.172308 17.998769 40.172307 40.172308v77.193846a40.172308 40.172308 0 1 1-80.344615 0V276.48c0-22.173538 17.959385-40.172308 40.172308-40.172308z m235.756307 0c22.212923 0 40.172308 17.998769 40.172308 40.172308v77.193846a40.172308 40.172308 0 1 1-80.344615 0V276.48c0-22.173538 17.998769-40.172308 40.172307-40.172308z m235.795693 0c22.173538 0 40.172308 17.998769 40.172307 40.172308v77.193846a40.172308 40.172308 0 1 1-80.344615 0V276.48c0-22.173538 17.959385-40.172308 40.172308-40.172308z"
                    fill="currentColor" />
                </svg>
              </button>
              <span class="tooltip">修改端口号</span>
            </div>
            <div class="tooltip-container">
              <button class="config-btn model-config" @click="$emit('open-model')">
                <svg width="20" height="20" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M469.333333 42.666667v42.666666H298.666667a128 128 0 0 0-128 128v128a213.333333 213.333333 0 0 0 213.333333 213.333334h256a213.333333 213.333333 0 0 0 213.333333-213.333334V213.333333a128 128 0 0 0-128-128h-170.666666V42.666667h-85.333334zM256 213.333333a42.666667 42.666667 0 0 1 42.666667-42.666666h426.666666a42.666667 42.666667 0 0 1 42.666667 42.666666v128a128 128 0 0 1-128 128H384a128 128 0 0 1-128-128V213.333333z m149.333333 170.666667a64 64 0 1 0 0-128 64 64 0 0 0 0 128z m213.333334 0a64 64 0 1 0 0-128 64 64 0 0 0 0 128zM256 938.666667a256 256 0 0 1 512 0h85.333333a341.333333 341.333333 0 1 0-682.666666 0h85.333333z"
                    fill="#718096" />
                </svg>
              </button>
              <span class="tooltip">选择模型</span>
            </div>
            <div class="tooltip-container">
              <button class="config-btn network-config" :class="{ active: networkOpen }" @click="$emit('toggle-network')">
                <svg width="20" height="20" viewBox="0 0 1544 1024" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M883.328799 691.443344H640.249453a75.589389 75.589389 0 1 1 0-151.178777h243.079346a183.801137 183.801137 0 0 0 183.577139-183.577139V334.77628a183.780774 183.780774 0 0 0-183.577139-183.577139H334.817007a183.780774 183.780774 0 0 0-183.577139 183.577139v21.931511a182.925506 182.925506 0 0 0 88.398043 156.79911 75.589389 75.589389 0 0 1-78.969733 128.758541C61.59965 581.643241 0 472.189317 0 356.687428V334.77628C0 150.180965 150.180965 0.020364 334.77628 0.020364h548.552519c184.595315 0 334.755916 150.160601 334.755916 334.755916v21.931511c0 184.574951-150.160601 334.735553-334.755916 334.735553z"
                    fill="currentColor" />
                  <path
                    d="M1209.593127 1024H661.162789c-184.595315 0-334.755916-150.180965-334.755916-334.77628v-21.951875c0-184.595315 150.160601-334.755916 334.755916-334.755916h253.362924a75.589389 75.589389 0 1 1 0 151.178777H661.162789a183.801137 183.801137 0 0 0-183.577139 183.577139v21.951875a183.801137 183.801137 0 0 0 183.577139 183.597503h548.430338a183.801137 183.801137 0 0 0 183.577139-183.597503v-21.951875a183.76041 183.76041 0 0 0-82.268623-152.726405 75.628079 75.628079 0 0 1 83.999522-125.785467 334.694826 334.694826 0 0 1 149.488606 278.511872v21.951875c0.061091 184.595315-150.119874 334.77628-334.796644 334.77628z"
                    fill="currentColor" />
                </svg>
              </button>
              <span class="tooltip">局域网访问</span>
            </div>
            <div class="tooltip-container">
              <button class="config-btn folder-config" @click="$emit('open-folder')">
                <svg width="20" height="20" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M418.688 133.333333a122.666667 122.666667 0 0 1 93.013333 42.666667H785.066667a186.666667 186.666667 0 0 1 186.581333 181.162667l0.085333 5.504v17.92h-0.256c0.170667 1.429333 0.256 2.88 0.256 4.373333V789.333333a186.666667 186.666667 0 0 1-186.666666 186.666667H238.933333A186.666667 186.666667 0 0 1 52.266667 789.333333V320a186.666667 186.666667 0 0 1 186.666666-186.666667z m0 74.666667H238.933333A112 112 0 0 0 126.933333 320v469.333333c0 61.866667 50.133333 112 112 112h546.133334c61.866667 0 112-50.133333 112-112V422.272H615.04a122.666667 122.666667 0 0 1-113.834667-76.992l-1.834666-4.842667-35.413334-100.416a48 48 0 0 0-45.269333-32.021333zM448 688a37.333333 37.333333 0 0 1 3.072 74.538667L448 762.666667h-170.666667a37.333333 37.333333 0 0 1-3.072-74.538667L277.333333 688h170.666667z m337.066667-437.333333H546.88l22.912 64.917333a48 48 0 0 0 41.685333 31.914667l3.562667 0.128 281.024-0.021334a112.021333 112.021333 0 0 0-106.389333-96.853333l-4.608-0.085333z"
                    fill="currentColor" />
                </svg>
              </button>
              <span class="tooltip">选择保存文件夹</span>
            </div>

          </div>
        </div>
        <div class="server-action">
          <button class="server-toggle-btn" :class="{ active: serverRunning, loading: isToggling }"
            @click="$emit('toggle-server')" :disabled="isToggling">
            {{ serverRunning ? '停止' : '启动' }}
          </button>
        </div>
      </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
  serverRunning: boolean
  serverUrl: string
  isToggling: boolean
  networkOpen: boolean
}>()

defineEmits<{
  'toggle-server': []
  'open-ocs': []
  'configure-port': []
  'open-model': []
  'toggle-network': []
  'open-folder': []
}>()
</script>

<style scoped>
.server-control {
  flex-shrink: 0;
  margin-bottom: 0;
}

.server-card {
  margin: 0;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 30px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.server-main-content {
  border-radius: 12px;
  padding: 6px 10px;
  border: 1px solid var(--bg-tertiary);
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
}

.server-config-controls {
  display: flex;
  gap: 12px;
  align-items: center;
}

.server-action {
  display: flex;
  align-items: center;
}

.server-info {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
}

.server-icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.3s ease;
}

.server-icon.running {
  background: #48bb78;
  box-shadow: 0 0 8px rgba(72, 187, 120, 0.4);
}

.server-icon.stopped {
  background: #e53e3e;
  box-shadow: 0 0 8px rgba(229, 62, 62, 0.4);
}

.server-details {
  flex: 1;
}

.server-title {
  font-size: 20px;
  font-weight: 600;
  color: #2d3748;
  margin-bottom: 8px;
}

.server-description {
  font-size: 14px;
  color: #718096;
  margin-bottom: 4px;
}

.server-status {
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.server-status.running {
  background: #c6f6d5;
  color: #22543d;
}

.server-status.stopped {
  background: #fed7d7;
  color: #742a2a;
}

.server-url {
  margin-top: 0px;
  font-size: 14px;
  color: #718096;
  margin-bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.url-link {
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 500;
}

.url-link:hover {
  text-decoration: underline;
}

.url-placeholder {
  color: #a0aec0;
  font-weight: 500;
}

.server-controls,
.server-config-controls {
  flex-shrink: 0;
  display: flex;
  gap: 12px;
  align-items: center;
}

.server-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  background: var(--server-toggle-bg);
  color: var(--server-toggle-text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 140px;
  justify-content: center;
}

.server-toggle-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px var(--server-toggle-shadow);
  background-color: var(--server-toggle-hover-bg);
  color: var(--server-toggle-hover-text);
}

.server-toggle-btn.active {
  background: var(--server-toggle-bg);
  color: var(--server-toggle-text);
}

.server-toggle-btn.active:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px var(--server-toggle-shadow);
  background-color: var(--server-toggle-hover-bg);
  color: var(--server-toggle-hover-text);
}

.server-toggle-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.server-toggle-btn.loading {
  pointer-events: none;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top: 2px solid currentColor;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.config-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 100%;
  border-radius: 8px;
  background: var(--bg-secondary);
  color: #718096;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.config-btn svg {
  width: 20px !important;
  height: 20px !important;
  fill: currentColor;
  flex-shrink: 0;
  display: block;
}

.config-btn.model-config svg {
  width: 20px !important;
  height: 20px !important;
  fill: #9ca3af;
  flex-shrink: 0;
  display: block;
}



.config-btn.active {
  color: #ffcb11;
}
/* Tooltip 样式 */
.tooltip-container {
  height: 32px;
  position: relative;
  display: inline-block;
  transition: all 0.3s ease;
}

.tooltip {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.3em 0.6em;
  background-color: rgb(255, 255, 255);
  color: rgb(34, 34, 34);
  border-radius: 12px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: all 0.3s ease;
  z-index: 1000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.tooltip::before {
  position: absolute;
  content: "";
  height: 0.6em;
  width: 0.6em;
  top: -0.4em;
  left: 50%;
  transform: translate(-50%) rotate(45deg);
  background-color: rgb(255, 255, 255);
  border-left: 1px solid rgba(0, 0, 0, 0.1);
  border-top: 1px solid rgba(0, 0, 0, 0.1);
}

.tooltip-container:hover .tooltip {
  bottom: -160%;
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
</style>
