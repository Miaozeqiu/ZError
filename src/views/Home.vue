<template>
  <div class="home-page">
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
              <button class="config-btn ocs-config" @click="openOCSConfig">
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
              <button class="config-btn port-config" @click="configurePort">
                <svg width="20" height="20" viewBox="0 0 1339 1024" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M1220.923077 0a118.153846 118.153846 0 0 1 118.153846 118.153846v520.822154a118.153846 118.153846 0 0 1-118.153846 118.153846h-91.372308a39.384615 39.384615 0 0 0-33.792 19.180308l-113.664 190.148923A118.153846 118.153846 0 0 1 880.679385 1024H462.296615a118.153846 118.153846 0 0 1-101.572923-57.777231l-112.876307-189.833846a39.384615 39.384615 0 0 0-33.87077-19.298461H118.153846a118.153846 118.153846 0 0 1-118.153846-118.153847V118.153846a118.153846 118.153846 0 0 1 118.153846-118.153846z m0 78.769231H118.153846a39.384615 39.384615 0 0 0-39.384615 39.384615v520.822154a39.384615 39.384615 0 0 0 39.384615 39.384615h95.862154a118.153846 118.153846 0 0 1 101.533538 57.737847l112.876308 189.87323a39.384615 39.384615 0 0 0 33.870769 19.259077H880.64a39.384615 39.384615 0 0 0 33.831385-19.180307l113.624615-190.148924a118.153846 118.153846 0 0 1 101.415385-57.540923H1220.923077a39.384615 39.384615 0 0 0 39.384615-39.384615V118.153846a39.384615 39.384615 0 0 0-39.384615-39.384615zM315.864615 236.307692c22.212923 0 40.172308 17.998769 40.172308 40.172308v77.193846a40.172308 40.172308 0 1 1-80.344615 0V276.48C275.692308 254.306462 293.691077 236.307692 315.864615 236.307692z m235.795693 0c22.173538 0 40.172308 17.998769 40.172307 40.172308v77.193846a40.172308 40.172308 0 1 1-80.344615 0V276.48c0-22.173538 17.959385-40.172308 40.172308-40.172308z m235.756307 0c22.212923 0 40.172308 17.998769 40.172308 40.172308v77.193846a40.172308 40.172308 0 1 1-80.344615 0V276.48c0-22.173538 17.998769-40.172308 40.172307-40.172308z m235.795693 0c22.173538 0 40.172308 17.998769 40.172307 40.172308v77.193846a40.172308 40.172308 0 1 1-80.344615 0V276.48c0-22.173538 17.959385-40.172308 40.172308-40.172308z"
                    fill="currentColor" />
                </svg>
              </button>
              <span class="tooltip">修改端口号</span>
            </div>
            <div class="tooltip-container">
              <button class="config-btn model-config" @click="openModelSelector">
                <svg width="20" height="20" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M469.333333 42.666667v42.666666H298.666667a128 128 0 0 0-128 128v128a213.333333 213.333333 0 0 0 213.333333 213.333334h256a213.333333 213.333333 0 0 0 213.333333-213.333334V213.333333a128 128 0 0 0-128-128h-170.666666V42.666667h-85.333334zM256 213.333333a42.666667 42.666667 0 0 1 42.666667-42.666666h426.666666a42.666667 42.666667 0 0 1 42.666667 42.666666v128a128 128 0 0 1-128 128H384a128 128 0 0 1-128-128V213.333333z m149.333333 170.666667a64 64 0 1 0 0-128 64 64 0 0 0 0 128z m213.333334 0a64 64 0 1 0 0-128 64 64 0 0 0 0 128zM256 938.666667a256 256 0 0 1 512 0h85.333333a341.333333 341.333333 0 1 0-682.666666 0h85.333333z"
                    fill="#718096" />
                </svg>
              </button>
              <span class="tooltip">选择模型</span>
            </div>
            <div class="tooltip-container">
              <button class="config-btn network-config" :class="{ active: networkOpen }" @click="toggleNetworkAccess">
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
              <button class="config-btn folder-config" @click="openFolderPicker">
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
            @click="toggleServer" :disabled="isToggling">
            {{ serverRunning ? '停止' : '启动' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 请求记录区域 -->
    <div class="request-logs-layout">
      <!-- 请求记录列表 -->
      <div class="request-logs-main">
        <div class="request-logs-card">
          <div class="request-logs-header">
            <div class="request-logs-info">
              <div class="request-logs-details">
                <h3 class="request-logs-title">请求记录 <span class="request-logs-count">{{ filteredRequestLogs.length
                    }}</span>
                </h3>
              </div>
            </div>
            <div class="request-logs-controls">
              <button class="config-btn clear-logs" @click="clearLogs" title="清空记录"
                :disabled="filteredRequestLogs.length === 0">
                <svg t="1761201528959" class="icon" viewBox="0 0 1024 1024" version="1.1"
                  xmlns="http://www.w3.org/2000/svg" p-id="8805" width="20" height="20">
                  <path
                    d="M38.4 170.666667h947.2a38.4 38.4 0 1 1 0 76.8H38.4A38.4 38.4 0 1 1 38.4 170.666667z m341.333333-170.666667h264.533334a38.4 38.4 0 1 1 0 76.8H379.733333a38.4 38.4 0 1 1 0-76.8z m0 341.333333a38.4 38.4 0 0 1 38.4 38.4v435.2a38.4 38.4 0 1 1-76.8 0V379.733333a38.4 38.4 0 0 1 38.4-38.4z m256 0a38.4 38.4 0 0 1 38.4 38.4v435.2a38.4 38.4 0 1 1-76.8 0V379.733333a38.4 38.4 0 0 1 38.4-38.4zM204.8 247.808V896A51.2 51.2 0 0 0 256 947.2h512a51.2 51.2 0 0 0 51.2-51.2V247.808H896V896a128 128 0 0 1-128 128H256a128 128 0 0 1-128-128V247.808h76.8z"
                    fill="currentColor" p-id="8806" />
                </svg>
              </button>
            </div>
          </div>

          <!-- 请求记录表格 -->
          <div class="request-table-container">
            <div v-if="filteredRequestLogs.length === 0" class="no-requests">
              <p>暂无请求记录</p>
              <p class="hint">启动服务器后，收到的请求将显示在这里</p>
            </div>
            <div v-else class="request-table-scroll-wrap" ref="requestTableScrollWrap">
              <div class="request-table-content" ref="requestTableContent" @scroll="onRequestTableScroll">
                <table class="request-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>状态</th>
                      <th>IP地址</th>
                      <th>问题</th>
                      <th>响应时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="log in filteredRequestLogs" :key="log.id"
                      :class="['request-row', getStatusClass(log.status), { 'selected': selectedLog?.id === log.id }]"
                      @click="showRequestDetails(log)">
                      <td class="timestamp">{{ formatTime(log.timestamp) }}</td>
                      <td class="status">
                        <span v-if="log.status" :class="['status-text', getStatusClass(log.status)]">
                          {{ log.status }}
                        </span>
                        <span v-else class="status-text pending">
                          处理中...
                        </span>
                      </td>
                      <td class="ip">{{ log.ip }}</td>
                      <td class="title" :title="getTitleFromRequestBody(log.requestBody)">
                        {{ truncateTitle(getTitleFromRequestBody(log.requestBody)) }}
                      </td>
                      <td class="response-time">
                        <span v-if="log.responseTime">{{ log.responseTime }}ms</span>
                        <span v-else class="pending">-</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <!-- 自定义滚动条 -->
              <div class="custom-scrollbar" :class="{ 'is-visible': requestTableScrollbarVisible }" ref="requestTableScrollbar" @mousedown="onRequestTableScrollbarMousedown">
                <div class="custom-scrollbar-thumb" ref="requestTableScrollbarThumb"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- 右侧弹出的请求详情面板 -->
    <div v-if="showLogDetails && selectedLog" class="request-details-overlay" :class="{ 'show': slideInActive }"
      :style="{ width: overlayWidth + 'px' }">
      <!-- 拖拽条 -->
      <div class="resizer" :class="{ active: isResizing }" @mousedown="startResize">
      </div>
      <div class="request-details-header">
        <button class="back-btn" @click="closeRequestDetails">
          <svg t="1760584170728" class="icon" viewBox="0 0 1536 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
            p-id="13220" width="20" height="20" transform="scale(-1,1)">
            <path
              d="M981.418667 71.893333A60.245333 60.245333 0 0 1 1070.506667 152.746667l-3.925334 4.309333L711.594667 512l354.986666 354.944c22.186667 22.144 23.466667 57.216 3.925334 80.896l-3.925334 4.266667a60.245333 60.245333 0 0 1-80.896 3.925333l-4.266666-3.925333-368.298667-368.213334a101.632 101.632 0 0 1-4.565333-138.88l4.565333-4.864 368.298667-368.256z"
              fill="#838B9F" opacity=".25" p-id="13221"></path>
            <path
              d="M469.418667 71.893333A60.245333 60.245333 0 0 1 558.506667 152.746667l-3.925334 4.309333L199.594667 512l354.986666 354.944c22.186667 22.144 23.466667 57.216 3.925334 80.896l-3.925334 4.266667a60.245333 60.245333 0 0 1-80.896 3.925333l-4.266666-3.925333-368.298667-368.213334a101.632 101.632 0 0 1-4.565333-138.88l4.565333-4.864 368.298667-368.256z"
              fill="#838B9F" p-id="13222"></path>
          </svg>
        </button>
        <h3>请求详情</h3>
      </div>

      <div class="request-details-content">
        <!-- 标签页导航 -->
        <div class="detail-tabs">
          <button class="tab-button" :class="{ active: activeTab === 'modelResponse' }"
            @click="activeTab = 'modelResponse'">
            AI 模型响应
          </button>
          <button class="tab-button" :class="{ active: activeTab === 'requestBody' }"
            @click="activeTab = 'requestBody'">
            请求体
          </button>
          <button class="tab-button" :class="{ active: activeTab === 'responseBody' }"
            @click="activeTab = 'responseBody'">
            响应体
          </button>
          <button class="tab-button" :class="{ active: activeTab === 'basic' }" @click="activeTab = 'basic'">
            基本信息
          </button>
          <button class="tab-button" :class="{ active: activeTab === 'headers' }" @click="activeTab = 'headers'">
            请求头
          </button>
        </div>

        <!-- 标签页内容 -->
        <div class="detail-scroll-wrap">
          <div class="tab-content" ref="detailContent" @scroll="onDetailScroll">

          <!-- 基本信息 -->
          <div v-if="activeTab === 'basic'" class="detail-section">
            <div class="detail-grid">
              <div class="detail-item">
                <label>时间:</label>
                <span>{{ selectedLog ? formatTime(selectedLog.timestamp) : '' }}</span>
              </div>
              <div class="detail-item">
                <label>方法:</label>
                <span :class="['method-badge', selectedLog ? selectedLog.method.toLowerCase() : '']">{{ selectedLog ?
                  selectedLog.method : '' }}</span>
              </div>
              <div class="detail-item">
                <label>路径:</label>
                <span>{{ selectedLog ? selectedLog.path : '' }}</span>
              </div>
              <div class="detail-item">
                <label>状态码:</label>
                <span v-if="selectedLog && selectedLog.status"
                  :class="['status-text', getStatusClass(selectedLog.status)]">{{ selectedLog.status }}</span>
                <span v-else class="status-text pending">处理中...</span>
              </div>
              <div class="detail-item">
                <label>IP地址:</label>
                <span>{{ selectedLog ? selectedLog.ip : '' }}</span>
              </div>
              <div class="detail-item">
                <label>响应时间:</label>
                <span v-if="selectedLog && selectedLog.responseTime">{{ selectedLog.responseTime }}ms</span>
                <span v-else class="pending">-</span>
              </div>
            </div>
          </div>

          <!-- 请求头 -->
          <div v-if="activeTab === 'headers'" class="detail-section">
            <div v-if="selectedLog && selectedLog.headers && Object.keys(selectedLog.headers).length > 0"
              class="headers-content">
              <div v-for="(value, key) in selectedLog.headers" :key="key" class="header-item">
                <strong>{{ key }}:</strong> {{ value }}
              </div>
            </div>
            <div v-else class="no-data">
              <span class="no-data-text">暂无请求头数据</span>
            </div>
          </div>

          <!-- 请求体 -->
          <div v-show="activeTab === 'requestBody'" class="detail-section">
            <div v-if="selectedLog && selectedLog.requestBody">
              <JsonCodeViewer :content="formatJSON(selectedLog.requestBody)" />
            </div>
            <div v-else class="no-data">
              <span class="no-data-text">暂无请求体数据</span>
            </div>
          </div>

          <!-- 响应体 -->
          <div v-show="activeTab === 'responseBody'" class="detail-section">
            <div v-if="selectedLog && selectedLog.responseBody">
              <JsonCodeViewer :content="formatJSON(selectedLog.responseBody)" />
            </div>
            <div v-else class="no-data">
              <span class="no-data-text">
                <span v-if="selectedLog && !selectedLog.status">处理中，响应体暂未生成...</span>
                <span v-else>暂无响应体数据</span>
              </span>
            </div>
          </div>

          <!-- 模型响应部分 -->
          <div v-if="activeTab === 'modelResponse'" class="detail-section">

            <!-- ===== URL 题目视觉分析视图 ===== -->
            <template v-if="selectedLog && selectedLog.urlQuestion">
              <div class="url-analysis-panel">
                <!-- 题目图片区域：URL 转 base64 后渲染 -->
                <div class="url-image-box">
                  <div v-if="selectedLog.urlQuestion.renderedHtml" class="url-image-ready"
                    v-html="selectedLog.urlQuestion.renderedHtml"></div>
                  <div v-else class="loading-indicator">
                    <div class="loading-spinner"></div>
                    <span>图片加载中...</span>
                  </div>
                </div>

                <!-- 分析结果区域 -->
                <div class="url-analysis-result">
                  <div v-if="selectedLog.urlQuestion.analyzing">
                    <div v-if="!selectedLog.urlQuestion.streamingResponse && !selectedLog.urlQuestion.streamingReasoning" class="loading-indicator">
                      <div class="loading-spinner"></div>
                      <span>视觉模型分析中...</span>
                    </div>
                    <div v-if="selectedLog.urlQuestion.streamingResponse || selectedLog.urlQuestion.streamingReasoning" class="content-stack-wrapper">
                      <AIOutputRender 
                        :streaming-reasoning="selectedLog.urlQuestion.streamingReasoning" 
                        :response="selectedLog.urlQuestion.streamingResponse" 
                        :is-loading="true" 
                      />
                    </div>
                  </div>
                  <div v-else-if="selectedLog.urlQuestion.analysisResult || selectedLog.urlQuestion.reasoningContent">
                    <div class="content-stack-wrapper">
                      <AIOutputRender 
                        :reasoning-content="selectedLog.urlQuestion.reasoningContent" 
                        :response="selectedLog.urlQuestion.analysisResult || ''" 
                      />
                    </div>
                  </div>
                  <div v-else-if="selectedLog.urlQuestion.analysisError" class="url-analysis-error">
                    <span>{{ selectedLog.urlQuestion.analysisError }}</span>
                    <button class="retry-btn-sm" @click="analyzeUrlQuestion(selectedLog!.id)">重试</button>
                  </div>
                  <div v-else class="no-data">
                    <span class="no-data-text">暂无分析结果</span>
                  </div>
                </div>

              </div>
            </template>

            <!-- ===== 多模型切换视图 ===== -->
            <template
              v-if="selectedLog && selectedLog.multiModelResponses && selectedLog.multiModelResponses.length > 0 && !selectedLog.urlQuestion">
              <!-- 横向模型选择器 -->
              <div class="multi-model-tabs">
                <button v-for="mr in selectedLog.multiModelResponses" :key="mr.modelId" class="multi-model-tab" :class="{
                  active: activeModelTab === mr.modelId,
                  loading: mr.isLoading,
                  summary: mr.modelName.startsWith('总结:'),
                  failed: !mr.isLoading && !!mr.response && mr.response.startsWith('错误:')
                }" @click="activeModelTab = mr.modelId">
                  <div v-if="mr.isLoading" class="loading-spinner-sm"></div>
                  <svg v-else-if="mr.modelName.startsWith('总结:')" width="12" height="12" viewBox="0 0 1024 1024"
                    xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M303.146667 375.04A128.042667 128.042667 0 0 0 426.666667 469.333333h170.666666a213.418667 213.418667 0 0 1 210.218667 176.896A128.042667 128.042667 0 0 1 768 896a128 128 0 0 1-47.146667-247.04A128.042667 128.042667 0 0 0 597.333333 554.666667h-170.666666a212.394667 212.394667 0 0 1-128-42.666667v135.253333a128.042667 128.042667 0 1 1-85.333334 0V376.746667a128.042667 128.042667 0 1 1 89.813334-1.706667zM256 298.666667a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m0 512a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m512 0a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z"
                      fill="currentColor"></path>
                  </svg>


                  <span>{{ mr.modelName }}</span>
                </button>
              </div>

              <!-- 当前选中模型的响应内容 -->
              <template v-for="mr in selectedLog.multiModelResponses" :key="mr.modelId">
                <div
                  v-if="activeModelTab === mr.modelId || (!activeModelTab && selectedLog.multiModelResponses[0].modelId === mr.modelId)"
                  class="model-response-card"
                  :class="{ 'is-loading': mr.isLoading, 'is-summary': mr.modelName.startsWith('总结:') }">
                  <div class="model-response-card-header">
                    <div class="model-response-card-title">
                      <div v-if="mr.modelName.startsWith('总结:')" class="summary-result-icon" title="最终总结答案">
                        <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M303.146667 375.04A128.042667 128.042667 0 0 0 426.666667 469.333333h170.666666a213.418667 213.418667 0 0 1 210.218667 176.896A128.042667 128.042667 0 0 1 768 896a128 128 0 0 1-47.146667-247.04A128.042667 128.042667 0 0 0 597.333333 554.666667h-170.666666a212.394667 212.394667 0 0 1-128-42.666667v135.253333a128.042667 128.042667 0 1 1-85.333334 0V376.746667a128.042667 128.042667 0 1 1 89.813334-1.706667zM256 298.666667a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m0 512a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m512 0a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z"
                            fill="currentColor"></path>
                        </svg>

                      </div>

                      <span class="card-model-name">{{ mr.modelName }}</span>

                      <span class="card-platform-name">{{ mr.platformName }}</span>
                      <span v-if="mr.modelName.startsWith('总结:')" class="summary-tag">最终答案</span>
                    </div>
                    <div v-if="mr.isLoading" class="card-loading-badge">
                      <div class="loading-spinner-sm"></div>
                      <span>响应中</span>
                    </div>
                    <div v-else class="card-done-badge">✓ 完成</div>
                  </div>
                  <div class="model-response-card-body">
                    <div v-if="mr.reasoningContent || mr.streamingReasoning || mr.response" class="content-stack-wrapper">
                      <AIOutputRender 
                        :reasoning-content="mr.reasoningContent" 
                        :streaming-reasoning="mr.streamingReasoning" 
                        :response="mr.response" 
                        :is-loading="mr.isLoading" 
                      />
                    </div>
                    <div v-else-if="mr.isLoading" class="card-waiting">
                      <div class="loading-dots"><span></span><span></span><span></span></div>
                    </div>
                    <div v-else class="no-data"><span class="no-data-text">暂无响应</span></div>
                  </div>

                </div>
              </template>
            </template>

            <!-- ===== 单模型视图（卡片化显示） ===== -->
            <template v-else-if="!selectedLog?.urlQuestion">
              <div
                v-if="selectedLog && (selectedLog.isModelCalling || selectedLog.modelResponse || selectedLog.reasoningContent || selectedLog.streamingReasoning)"
                class="model-response-card"
                :class="{
                  'is-loading': !!selectedLog.isModelCalling,
                  'is-summary': !!(selectedLog.modelInfo && selectedLog.modelInfo.modelName.startsWith('总结:'))
                }">
                <div class="model-response-card-header">
                  <div class="model-response-card-title">
                    <div
                      v-if="selectedLog.modelInfo && selectedLog.modelInfo.modelName.startsWith('总结:')"
                      class="summary-result-icon"
                      title="最终总结答案">
                      <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                        <path
                          d="M303.146667 375.04A128.042667 128.042667 0 0 0 426.666667 469.333333h170.666666a213.418667 213.418667 0 0 1 210.218667 176.896A128.042667 128.042667 0 0 1 768 896a128 128 0 0 1-47.146667-247.04A128.042667 128.042667 0 0 0 597.333333 554.666667h-170.666666a212.394667 212.394667 0 0 1-128-42.666667v135.253333a128.042667 128.042667 0 1 1-85.333334 0V376.746667a128.042667 128.042667 0 1 1 89.813334-1.706667zM256 298.666667a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m0 512a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z m512 0a42.666667 42.666667 0 1 0 0-85.333334 42.666667 42.666667 0 0 0 0 85.333334z"
                          fill="currentColor"></path>
                      </svg>
                    </div>

                    <span class="card-model-name">{{ selectedLog.modelInfo?.modelName || 'AI 模型响应' }}</span>
                    <span v-if="selectedLog.modelInfo?.platformName" class="card-platform-name">{{ selectedLog.modelInfo.platformName }}</span>
                    <span
                      v-if="selectedLog.modelInfo && selectedLog.modelInfo.modelName.startsWith('总结:')"
                      class="summary-tag">最终答案</span>
                  </div>
                  <div v-if="selectedLog.isModelCalling" class="card-loading-badge">
                    <div class="loading-spinner-sm"></div>
                    <span>响应中</span>
                  </div>
                  <div v-else class="card-done-badge">✓ 完成</div>
                </div>
                <div class="model-response-card-body">
                  <div v-if="selectedLog.reasoningContent || selectedLog.streamingReasoning || selectedLog.modelResponse" class="content-stack-wrapper">
                    <AIOutputRender 
                      :reasoning-content="selectedLog.reasoningContent" 
                      :streaming-reasoning="selectedLog.streamingReasoning" 
                      :response="selectedLog.modelResponse" 
                      :is-loading="selectedLog.isModelCalling" 
                    />
                  </div>
                  <div v-else-if="selectedLog.isModelCalling" class="card-waiting">
                    <div class="loading-dots"><span></span><span></span><span></span></div>
                  </div>
                  <div v-else class="no-data"><span class="no-data-text">暂无响应</span></div>
                </div>

              </div>
              <div v-else class="no-data">
                <span class="no-data-text">
                  <span v-if="selectedLog && !selectedLog.status">等待AI模型响应...</span>
                  <span v-else>暂无AI模型响应数据</span>
                </span>
              </div>
            </template>

          </div>
          </div>
          <div class="custom-scrollbar" :class="{ 'is-visible': scrollbarVisible, 'has-overflow': scrollbarEnabled }"

            ref="customScrollbar" @mousedown="onScrollbarMousedown">
            <div class="custom-scrollbar-thumb" ref="customScrollbarThumb"></div>
          </div>
        </div>
      </div>
    </div>


    <!-- 端口配置对话框 -->
    <PortConfigDialog :show="showPortDialog" :current-port="configuredPort" @close="showPortDialog = false"
      @confirm="handlePortConfirm" />

    <!-- 模型选择对话框 -->
    <ModelSelectorDialog :show="showModelSelector" :selected-text-model-ids="globalSelectedTextModels.map(m => m.id)"
      :selected-vision-model-id="globalSelectedVisionModel?.id || null"
      :selected-summary-model-ids="globalSelectedSummaryModels.map(m => m.id)" :available-models="availableModels"
      :platforms="platforms" @close="showModelSelector = false" @model-selected="selectModel" />

    <FolderPickerDialog :visible="showFolderPicker" :initial-folder-id="settings.questionSaveFolderId"
      @cancel="showFolderPicker = false" @confirm="handleFolderConfirm" />

  </div>

  <!-- OCS配置对话框 -->

  <OCSConfigDialog :visible="showOCSConfig" :current-port="configuredPort" @close="showOCSConfig = false"
    @test="testOCSConnection" />

  <ModelWarningDialog :visible="showNoModelDialog" @close="showNoModelDialog = false"
    @still-open="handleNoModelStillOpen" @select-model="handleNoModelSelect" />

  <!-- 后台自动渲染 URL 题目图片已移除，现直接使用原始 URL 渲染 img 标签 -->
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { useSettings } from '../services/settings'
import { useModelConfig } from '../services/modelConfig'
import type { AIModel } from '../services/modelConfig'
import { databaseService } from '../services/database'

import PortConfigDialog from './home/PortConfigDialog.vue'
import ModelSelectorDialog from './home/ModelSelectorDialog.vue'
import OCSConfigDialog from './home/OCSConfigDialog.vue'
import FolderPickerDialog from '../components/FolderPickerDialog.vue'
import AIOutputRender from '../components/AIOutputRender.vue'
import MarkdownRender from 'markstream-vue'

import 'markstream-vue/index.css'
import ModelWarningDialog from './home/ModelWarningDialog.vue'
import JsonCodeViewer from './home/JsonCodeViewer.vue'
import { findQuestionImageMatches, fetchQuestionImageBase64, extractQuestionImageUrls } from '../utils/questionImage'



const emit = defineEmits(['navigate'])

// 使用设置管理器
const { settings, get, set, save } = useSettings()

// 使用模型配置管理器
const {
  settings: modelSettings,
  availableModels,
  selectedModel: globalSelectedModel,
  selectedTextModel: globalSelectedTextModel,
  selectedTextModels: globalSelectedTextModels,
  selectedSummaryModels: globalSelectedSummaryModels,
  selectedVisionModel: globalSelectedVisionModel,
  setSelectedModel,
  setSelectedTextModel,
  setSelectedVisionModel,
  toggleSelectedTextModel,
  toggleSelectedSummaryModel,
  platforms
} = useModelConfig()

import { serverRunning as globalServerRunning } from '../services/serverState'

// Server state
const serverRunning = ref(false)
watch(serverRunning, (val) => { globalServerRunning.value = val })
const isToggling = ref(false)
const serverUrl = ref('')

// 从设置中获取网络配置 - 使用响应式设置
const configuredPort = computed(() => settings.network.serverPort)
const networkOpen = computed(() => settings.network.enableLanAccess)

// 实际运行的服务器端口（可能与配置不同）
const serverPort = ref<number | null>(null)

// 端口配置对话框状态
const showPortDialog = ref(false)

// 模型选择对话框状态
const showModelSelector = ref(false)
const showNoModelDialog = ref(false)
const pendingStart = ref(false)

// OCS题库配置对话框状态
const showOCSConfig = ref(false)

const showFolderPicker = ref(false)
// 当前 URL 内容窗口的唯一 ID，用于隔离多窗口数据
const currentUrlWindowId = ref('')

// 请求记录相关状态
interface MultiModelResponse {
  modelId: string
  modelName: string
  platformName: string
  response: string
  reasoningContent?: string
  streamingReasoning?: string
  isLoading: boolean
}

interface RequestLog {
  id: string
  timestamp: number
  method: string
  path: string
  status?: number // 可选，开始阶段为undefined
  ip: string
  userAgent: string
  responseTime?: number // 可选，开始阶段为undefined
  requestBody?: string
  responseBody?: string
  headers?: Record<string, string>
  stage?: string // 'started' 或 'completed'
  modelResponse?: string // 模型响应内容（单模型）
  reasoningContent?: string // 模型思考过程（最终，单模型）
  streamingReasoning?: string // 模型思考过程（流式，单模型）
  isModelCalling?: boolean // 是否正在调用模型
  modelInfo?: { // 模型信息（单模型）
    platformName: string
    modelName: string
    modelId: string
  }
  multiModelResponses?: MultiModelResponse[] // 多模型并发响应
  urlQuestion?: { // URL 题目数据（视觉分析）
    title: string
    options: string
    imageUrl: string | null
    analyzing: boolean
    analysisResult: string | null
    analysisError: string
    streamingResponse: string
    streamingReasoning: string
    reasoningContent: string
    renderedHtml?: string // 将 URL 替换为 base64 后的展示 HTML
  }

}

const requestLogs = ref<RequestLog[]>([])
const selectedLog = ref<RequestLog | null>(null)
const showLogDetails = ref(false)
const slideInActive = ref(false)

// 标签页相关状态
const activeTab = ref('basic')
const activeModelTab = ref('')
const detailContent = ref<HTMLElement | null>(null)
const customScrollbar = ref<HTMLElement | null>(null)
const customScrollbarThumb = ref<HTMLElement | null>(null)
const scrollbarVisible = ref(false)
const scrollbarEnabled = ref(false)

let isDraggingScrollbar = false
let dragStartY = 0
let dragStartScrollTop = 0
let scrollHideTimer: ReturnType<typeof setTimeout> | null = null
let detailContentObserver: MutationObserver | null = null

const showScrollbar = () => {
  if (!scrollbarEnabled.value) return
  scrollbarVisible.value = true
  if (scrollHideTimer) clearTimeout(scrollHideTimer)
  scrollHideTimer = setTimeout(() => {
    scrollbarVisible.value = false
  }, 1500)
}

const updateScrollbarThumb = () => {
  const content = detailContent.value
  const thumb = customScrollbarThumb.value
  const bar = customScrollbar.value
  if (!content || !thumb || !bar) return

  const maxScroll = content.scrollHeight - content.clientHeight
  const hasOverflow = maxScroll > 0
  scrollbarEnabled.value = hasOverflow

  if (!hasOverflow) {
    thumb.style.height = '0px'
    thumb.style.transform = 'translateY(0)'
    scrollbarVisible.value = false
    return
  }

  const barHeight = bar.clientHeight || content.clientHeight
  const ratio = content.clientHeight / content.scrollHeight
  const thumbHeight = Math.max(barHeight * ratio, 36)
  const maxThumbTop = Math.max(barHeight - thumbHeight, 0)
  const thumbTop = maxScroll > 0 ? (content.scrollTop / maxScroll) * maxThumbTop : 0

  thumb.style.height = `${thumbHeight}px`
  thumb.style.transform = `translateY(${thumbTop}px)`
}

const onDetailScroll = () => {
  updateScrollbarThumb()
  showScrollbar()
}

const onScrollbarMousedown = (e: MouseEvent) => {
  const thumb = customScrollbarThumb.value
  const content = detailContent.value
  const bar = customScrollbar.value
  if (!thumb || !content || !bar || !scrollbarEnabled.value) return

  isDraggingScrollbar = true
  dragStartY = e.clientY
  dragStartScrollTop = content.scrollTop
  showScrollbar()

  const onMousemove = (event: MouseEvent) => {
    if (!isDraggingScrollbar) return
    const thumbHeight = thumb.clientHeight
    const barHeight = bar.clientHeight
    const delta = event.clientY - dragStartY
    const maxScroll = content.scrollHeight - content.clientHeight
    const maxThumbTop = Math.max(barHeight - thumbHeight, 1)
    content.scrollTop = dragStartScrollTop + (delta / maxThumbTop) * maxScroll
  }

  const onMouseup = () => {
    isDraggingScrollbar = false
    document.removeEventListener('mousemove', onMousemove)
    document.removeEventListener('mouseup', onMouseup)
  }

  document.addEventListener('mousemove', onMousemove)
  document.addEventListener('mouseup', onMouseup)
  e.preventDefault()
}

const bindDetailContentObserver = async () => {
  await nextTick()
  detailContentObserver?.disconnect()
  updateScrollbarThumb()

  if (!detailContent.value) return
  detailContentObserver = new MutationObserver(() => {
    updateScrollbarThumb()
  })
  detailContentObserver.observe(detailContent.value, {
    childList: true,
    subtree: true,
    characterData: true
  })
}

// 接收来自顶层 App 的折叠触发器，并在切换顶层 tab 时收起详情面板
const props = defineProps<{ collapseTrigger?: number }>()
watch(() => props.collapseTrigger, () => {
  if (showLogDetails.value) {
    closeRequestDetails()
  }
})




// 过滤后的请求日志（排除无请求头内容的记录）
const filteredRequestLogs = computed(() => {
  return requestLogs.value.filter(log => {
    // 如果有请求头且不为空，则显示该记录
    if (log.headers && Object.keys(log.headers).length > 0) {
      return true
    }
    // 如果没有请求头但有其他重要内容（请求体、响应体、模型响应），也显示
    if (log.requestBody || log.responseBody || log.modelResponse) {
      return true
    }
    // 其他情况不显示
    return false
  })
})

// 右侧面板拖拽功能
const overlayWidth = ref(600) // 默认宽度
const isResizing = ref(false)

watch(showLogDetails, async (visible) => {
  if (visible) {
    await bindDetailContentObserver()
    showScrollbar()
    return
  }

  detailContentObserver?.disconnect()
  detailContentObserver = null
  scrollbarVisible.value = false
  scrollbarEnabled.value = false
  if (scrollHideTimer) {
    clearTimeout(scrollHideTimer)
    scrollHideTimer = null
  }
})

watch([activeTab, activeModelTab, overlayWidth, () => selectedLog.value?.id], async () => {
  if (!showLogDetails.value) return
  await bindDetailContentObserver()
})

// 拖拽功能

const startResize = (event: MouseEvent) => {
  isResizing.value = true
  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  document.body.classList.add('resizing')
  event.preventDefault()
}

const handleResize = (event: MouseEvent) => {
  if (!isResizing.value) return

  const newWidth = window.innerWidth - event.clientX
  const minWidth = 300
  const maxWidth = window.innerWidth * 0.8 // 最大占屏幕宽度的80%

  if (newWidth >= minWidth && newWidth <= maxWidth) {
    overlayWidth.value = newWidth
  }
}

const stopResize = () => {
  isResizing.value = false
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.classList.remove('resizing')
}
let logUpdateInterval: NodeJS.Timeout | null = null
let sseEventSource: EventSource | null = null
// 维护每个请求的心跳定时器，确保在没有内容流入时也能向后端发送进度心跳
const heartbeatIntervals = new Map<string, number>()
const activeModelAbortControllers = new Map<string, Set<AbortController>>()
const cancelledRequestIds = new Set<string>()
const MODEL_REQUEST_CANCELLED_MESSAGE = '服务已停止，已取消所有模型请求'

const createCancelledRequestError = (message = MODEL_REQUEST_CANCELLED_MESSAGE) => {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

const isAbortLikeError = (error: unknown) => {
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError' || /aborted|abort|cancelled|canceled|取消/i.test(error.message)
}

const registerAbortController = (requestId: string, abortController: AbortController) => {
  const controllers = activeModelAbortControllers.get(requestId) ?? new Set<AbortController>()
  controllers.add(abortController)
  activeModelAbortControllers.set(requestId, controllers)
}

const unregisterAbortController = (requestId: string, abortController: AbortController) => {
  const controllers = activeModelAbortControllers.get(requestId)
  if (!controllers) return
  controllers.delete(abortController)
  if (controllers.size === 0) {
    activeModelAbortControllers.delete(requestId)
  }
}

const clearRequestHeartbeat = (requestId: string) => {
  const timerId = heartbeatIntervals.get(requestId)
  if (typeof timerId === 'number') {
    window.clearInterval(timerId)
    heartbeatIntervals.delete(requestId)
  }
}

const isRequestCancelled = (requestId: string) => cancelledRequestIds.has(requestId)

const markRequestAsCancelled = (requestId: string, message = MODEL_REQUEST_CANCELLED_MESSAGE) => {
  const log = requestLogs.value.find(entry => entry.id === requestId)
  if (!log) return

  log.isModelCalling = false
  log.streamingReasoning = ''
  log.stage = 'completed'
  log.status = log.status ?? 499
  log.responseTime = log.responseTime ?? Math.max(Date.now() - log.timestamp, 0)

  if (!log.responseBody) {
    log.responseBody = message
  }

  if (!log.modelResponse || log.modelResponse.startsWith('错误:')) {
    log.modelResponse = message
  }

  if (log.multiModelResponses?.length) {
    log.multiModelResponses.forEach((entry) => {
      entry.isLoading = false
      entry.streamingReasoning = ''
      if (!entry.response || entry.response.startsWith('错误:')) {
        entry.response = message
      }
    })
  }

  if (log.urlQuestion) {
    const partialAnalysisResult = (log.urlQuestion.analysisResult || log.urlQuestion.streamingResponse || '').trim()
    const partialReasoning = (log.urlQuestion.reasoningContent || log.urlQuestion.streamingReasoning || '').trim()

    log.urlQuestion.analyzing = false
    log.urlQuestion.streamingResponse = ''
    log.urlQuestion.streamingReasoning = ''

    if (partialAnalysisResult || partialReasoning) {
      log.urlQuestion.analysisResult = partialAnalysisResult || log.urlQuestion.analysisResult
      log.urlQuestion.reasoningContent = partialReasoning
      log.urlQuestion.analysisError = ''
    } else {
      log.urlQuestion.analysisError = message
    }
  }
}

const cancelAllInFlightModelRequests = (message = MODEL_REQUEST_CANCELLED_MESSAGE) => {
  const requestIds = new Set<string>([
    ...activeModelAbortControllers.keys(),
    ...heartbeatIntervals.keys(),
    ...activeUrlAnalysisRequestIds,
  ])

  requestIds.forEach((requestId) => {
    cancelledRequestIds.add(requestId)
    clearRequestHeartbeat(requestId)
    markRequestAsCancelled(requestId, message)
  })

  activeModelAbortControllers.forEach((controllers) => {
    controllers.forEach((controller) => controller.abort())
  })
  activeModelAbortControllers.clear()
}

// 请求记录管理方法
const addRequestLog = (log: Omit<RequestLog, 'id'>) => {
  const newLog: RequestLog = {
    ...log,
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9)
  }
  requestLogs.value.unshift(newLog) // 新记录添加到顶部

  // 限制记录数量，最多保留100条
  if (requestLogs.value.length > 100) {
    requestLogs.value = requestLogs.value.slice(0, 100)
  }
}

// 启动SSE连接
const startSSEConnection = () => {
  if (!serverRunning.value || !serverUrl.value) {
    return
  }

  // 关闭现有连接
  if (sseEventSource) {
    sseEventSource.close()
  }

  try {
    const sseUrl = serverUrl.value.replace('http://', 'http://').replace(':3000', ':3000') + '/api/logs/stream'
    console.log('连接SSE:', sseUrl)

    sseEventSource = new EventSource(sseUrl)

    // 监听所有类型的事件
    sseEventSource.onmessage = (event) => {
      console.log('收到SSE默认消息事件:', event.data)
      try {
        const logData = JSON.parse(event.data)
        console.log('解析后的日志数据:', logData)

        // 只处理 /query 路径的 GET 和 POST 请求
        if (logData.path !== '/query' || (logData.method !== 'POST' && logData.method !== 'GET')) {
          console.log('跳过非 query 请求:', logData.method, logData.path)
          return
        }

        // 处理分阶段的请求信息
        if (logData.stage === 'started') {
          // 请求开始阶段
          const newLog: RequestLog = {
            id: logData.id,
            timestamp: new Date(logData.timestamp).getTime(),
            method: logData.method,
            path: logData.path,
            status: undefined, // 开始阶段没有状态码
            ip: logData.ip || '127.0.0.1',
            userAgent: logData.user_agent || 'Unknown',
            responseTime: undefined, // 开始阶段没有响应时间
            requestBody: logData.request_body || '',
            responseBody: undefined, // 开始阶段没有响应体
            headers: logData.headers || {},
            stage: 'started'
          }

          console.log('创建的请求开始日志:', newLog)
          requestLogs.value.unshift(newLog)
          injectUrlQuestionIfNeeded(newLog)

        } else if (logData.stage === 'completed') {
          // 请求完成阶段，更新现有记录
          const existingLogIndex = requestLogs.value.findIndex(log => log.id === logData.id)

          if (existingLogIndex !== -1) {
            // 更新现有记录
            const existingLog = requestLogs.value[existingLogIndex]
            // 采用就地更新，保持对象引用，确保 selectedLog 同步
            existingLog.status = logData.status
            existingLog.responseTime = logData.response_time
            existingLog.responseBody = logData.response_body || ''
            existingLog.stage = 'completed'
            console.log('更新的请求完成日志:', existingLog)
          } else {
            // 如果没有找到开始记录，创建一个完整的记录
            const newLog: RequestLog = {
              id: logData.id,
              timestamp: new Date(logData.timestamp).getTime(),
              method: logData.method,
              path: logData.path,
              status: logData.status,
              ip: '127.0.0.1', // 完成阶段没有IP信息，使用默认值
              userAgent: 'Unknown', // 完成阶段没有User-Agent信息，使用默认值
              responseTime: logData.response_time,
              requestBody: '', // 完成阶段没有请求体信息
              responseBody: logData.response_body || '',
              headers: {}, // 完成阶段没有请求头信息
              stage: 'completed'
            }
            console.log('创建的请求完成日志（无开始记录）:', newLog)
            requestLogs.value.unshift(newLog)
          }
        }

        // 限制日志数量
        if (requestLogs.value.length > 100) {
          requestLogs.value = requestLogs.value.slice(0, 100)
        }

      } catch (error) {
        console.error('解析SSE日志数据失败:', error, '原始数据:', event.data)
      }
    }

    sseEventSource.addEventListener('log', (event) => {
      console.log('收到SSE日志事件:', event.data) // 添加调试日志
      try {
        const eventData = JSON.parse(event.data)
        console.log('解析后的事件数据:', eventData) // 添加调试日志

        // 检查是否是RequestLog类型的事件
        if (eventData.type === 'request_log') {
          const logData = eventData.RequestLog || eventData

          // 只处理 /query 路径的 GET 和 POST 请求
          if (logData.path !== '/query' || (logData.method !== 'POST' && logData.method !== 'GET')) {
            console.log('跳过非 query 请求:', logData.method, logData.path)
            return
          }

          // 处理分阶段的请求信息
          if (logData.stage === 'started') {
            // 请求开始阶段
            const newLog: RequestLog = {
              id: logData.id,
              timestamp: new Date(logData.timestamp).getTime(),
              method: logData.method,
              path: logData.path,
              status: undefined, // 开始阶段没有状态码
              ip: logData.ip || '127.0.0.1',
              userAgent: logData.user_agent || 'Unknown',
              responseTime: undefined, // 开始阶段没有响应时间
              requestBody: logData.request_body || '',
              responseBody: undefined, // 开始阶段没有响应体
              headers: logData.headers || {},
              stage: 'started'
            }

            console.log('创建的请求开始日志:', newLog)
            requestLogs.value.unshift(newLog)
            injectUrlQuestionIfNeeded(newLog)

          } else if (logData.stage === 'completed') {
            // 请求完成阶段，更新现有记录
            const existingLogIndex = requestLogs.value.findIndex(log => log.id === logData.id)

            if (existingLogIndex !== -1) {
              // 更新现有记录
              const existingLog = requestLogs.value[existingLogIndex]
              // 采用就地更新，保持对象引用，确保 selectedLog 同步
              existingLog.status = logData.status
              existingLog.responseTime = logData.response_time
              existingLog.responseBody = logData.response_body || ''
              existingLog.stage = 'completed'
              console.log('更新的请求完成日志:', existingLog)

              // 检查是否是URL检测响应，如果是则显示URL处理弹窗
              checkAndShowUrlDialog(existingLog)
            } else {
              // 如果没有找到开始记录，创建一个完整的记录
              const newLog: RequestLog = {
                id: logData.id,
                timestamp: new Date(logData.timestamp).getTime(),
                method: logData.method,
                path: logData.path,
                status: logData.status,
                ip: '127.0.0.1', // 完成阶段没有IP信息，使用默认值
                userAgent: 'Unknown', // 完成阶段没有User-Agent信息，使用默认值
                responseTime: logData.response_time,
                requestBody: '', // 完成阶段没有请求体信息
                responseBody: logData.response_body || '',
                headers: {}, // 完成阶段没有请求头信息
                stage: 'completed'
              }
              console.log('创建的请求完成日志（无开始记录）:', newLog)
              requestLogs.value.unshift(newLog)

              // 检查是否是URL检测响应，如果是则显示URL处理弹窗
              checkAndShowUrlDialog(newLog)
            }
          }

          // 限制日志数量
          if (requestLogs.value.length > 100) {
            requestLogs.value = requestLogs.value.slice(0, 100)
          }
        }

      } catch (error) {
        console.error('解析SSE日志数据失败:', error, '原始数据:', event.data)
      }
    })

    // 监听模型调用请求事件
    sseEventSource.addEventListener('model_call_request', (event) => {
      console.log('收到模型调用请求事件:', event.data)
      try {
        const eventData = JSON.parse(event.data)
        const requestData = eventData.ModelCallRequest || eventData

        console.log('模型调用请求数据:', requestData)

        // 检测是否是 URL 题目，触发视觉分析窗口
        if (requestData.query && requestData.query.startsWith('__URL_QUESTION__:')) {
          handleUrlQuestionRequest(requestData.request_id, requestData.query.slice('__URL_QUESTION__:'.length))
          return
        }

        // 调用模型API
        callModelAPI(requestData.request_id, requestData.query)

      } catch (error) {
        console.error('解析模型调用请求数据失败:', error, '原始数据:', event.data)
      }
    })

    // 监听模型调用响应事件
    sseEventSource.addEventListener('model_call_response', (event) => {
      console.log('收到模型调用响应事件:', event.data)
      try {
        const eventData = JSON.parse(event.data)
        const responseData = eventData.ModelCallResponse || eventData

        console.log('模型调用响应数据:', responseData)

        // 如果后端携带 reasoning_content，先更新思考过程，再更新最终结果
        const reasoning = getReasoningContentValue(responseData)
        if (reasoning) {
          updateRequestDetailsWithModelReasoning(responseData.request_id, reasoning)
        }
        updateRequestDetailsWithModelResponse(responseData.request_id, responseData.content)


      } catch (error) {
        console.error('解析模型调用响应数据失败:', error, '原始数据:', event.data)
      }
    })

    sseEventSource.addEventListener('open', () => {
      console.log('SSE连接已建立')
    })

    sseEventSource.addEventListener('message', (event) => {
      console.log('收到SSE通用消息事件:', event.data)
    })

    sseEventSource.addEventListener('error', (error) => {
      console.error('SSE连接错误:', error)
      console.log('SSE连接状态:', sseEventSource?.readyState)
      // 连接错误时，回退到轮询模式
      setTimeout(() => {
        if (serverRunning.value) {
          startLogPolling()
        }
      }, 5000)
    })
  } catch (error) {
    console.error('启动SSE连接失败:', error)
    // 回退到轮询模式
    startLogPolling()
  }
}

// 停止SSE连接
const stopSSEConnection = () => {
  if (sseEventSource) {
    sseEventSource.close()
    sseEventSource = null
    console.log('SSE连接已关闭')
  }
}

// 启动实时更新机制（轮询模式，作为SSE的备用方案）
const startLogPolling = () => {
  if (logUpdateInterval) {
    clearInterval(logUpdateInterval)
  }

  console.log('SSE连接失败，启动轮询模式作为备用方案')
  // 注意：这里不再调用fetchRequestLogs，因为我们已经使用SSE
  // 轮询模式主要用于在SSE连接失败时尝试重新建立SSE连接
  logUpdateInterval = setInterval(async () => {
    if (serverRunning.value) {
      // 尝试重新建立SSE连接
      if (!sseEventSource || sseEventSource.readyState === EventSource.CLOSED) {
        console.log('尝试重新建立SSE连接...')
        startSSEConnection()
      }
    }
  }, 10000) // 每10秒尝试重新连接一次
}

// 停止实时更新机制
const stopLogPolling = () => {
  if (logUpdateInterval) {
    clearInterval(logUpdateInterval)
    logUpdateInterval = null
  }
}

const clearLogs = async () => {
  if (!isTauri.value) {
    // 在非Tauri环境中只清空本地数组
    requestLogs.value = []
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('clear_request_logs')
    requestLogs.value = []
    console.log('请求日志已清空')
  } catch (error) {
    console.error('清空请求日志失败:', error)
    // 即使API调用失败，也清空本地数组
    requestLogs.value = []
  }
}

// 获取请求日志（保留此函数用于手动刷新或初始化，但不在SSE模式下自动调用）
const fetchRequestLogs = async () => {
  if (!isTauri.value) {
    console.log('不在 Tauri 环境中，跳过获取请求日志')
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const logs = await invoke('get_request_logs')

    // 转换日志格式以匹配前端接口
    const formattedLogs = (logs as any[]).map((log: any) => ({
      id: `${log.timestamp}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(log.timestamp).getTime(),
      method: log.method,
      path: log.path,
      status: log.status,
      ip: '127.0.0.1', // 后端暂时没有IP信息，使用默认值
      userAgent: 'Unknown', // 后端暂时没有User-Agent信息，使用默认值
      responseTime: log.response_time
    }))

    // 只在没有SSE连接时更新日志，避免重复
    if (!sseEventSource || sseEventSource.readyState !== EventSource.OPEN) {
      requestLogs.value = formattedLogs
      console.log('获取到请求日志:', requestLogs.value.length, '条')
    }
  } catch (error) {
    console.error('获取请求日志失败:', error)
  }
}

// 格式化时间
const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

// 获取状态码对应的CSS类
const getStatusClass = (status: number) => {
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'redirect'
  if (status >= 400 && status < 500) return 'client-error'
  if (status >= 500) return 'server-error'
  return 'unknown'
}

// 请求表格自定义滚动条
const requestTableScrollWrap = ref<HTMLElement | null>(null)
const requestTableContent = ref<HTMLElement | null>(null)
const requestTableScrollbar = ref<HTMLElement | null>(null)
const requestTableScrollbarThumb = ref<HTMLElement | null>(null)
const requestTableScrollbarVisible = ref(false)
let requestTableDragStartY = 0
let requestTableDragStartScrollTop = 0
let requestTableDragging = false
let requestTableHideTimer: ReturnType<typeof setTimeout> | null = null

const showRequestTableScrollbar = () => {
  requestTableScrollbarVisible.value = true
  if (requestTableHideTimer) clearTimeout(requestTableHideTimer)
  requestTableHideTimer = setTimeout(() => {
    requestTableScrollbarVisible.value = false
  }, 1500)
}

const updateRequestTableScrollbarThumb = () => {
  const content = requestTableContent.value
  const thumb = requestTableScrollbarThumb.value
  const bar = requestTableScrollbar.value
  if (!content || !thumb || !bar) return

  const scrollRatio = content.scrollTop / (content.scrollHeight - content.clientHeight || 1)
  const thumbHeight = Math.max((content.clientHeight / content.scrollHeight) * bar.clientHeight, 20)
  const maxTop = bar.clientHeight - thumbHeight
  thumb.style.height = `${thumbHeight}px`
  thumb.style.top = `${scrollRatio * maxTop}px`
}

const onRequestTableScroll = () => {
  showRequestTableScrollbar()
  updateRequestTableScrollbarThumb()
}

const onRequestTableScrollbarMousedown = (e: MouseEvent) => {
  e.preventDefault() // 阻止默认的文本选择行为
  const thumb = requestTableScrollbarThumb.value
  const content = requestTableContent.value
  const wrap = requestTableScrollWrap.value
  if (!thumb || !content) return

  requestTableDragging = true
  requestTableDragStartY = e.clientY
  requestTableDragStartScrollTop = content.scrollTop
  
  if (wrap) wrap.classList.add('is-dragging')
  document.body.style.userSelect = 'none' // 拖拽时全局禁用文本选择

  const onMouseMove = (e: MouseEvent) => {
    if (!requestTableDragging) return
    const deltaY = e.clientY - requestTableDragStartY
    
    // 计算滚动条的实际可拖动范围
    const bar = requestTableScrollbar.value
    const thumbHeight = thumb.clientHeight
    const maxTop = (bar?.clientHeight || content.clientHeight) - thumbHeight
    
    // 将鼠标移动距离转换为内容滚动的比例
    const scrollRatio = deltaY / (maxTop || 1)
    
    // 按照比例更新内容的 scrollTop
    content.scrollTop = requestTableDragStartScrollTop + scrollRatio * (content.scrollHeight - content.clientHeight)
    showRequestTableScrollbar()
    updateRequestTableScrollbarThumb()
  }

  const onMouseUp = () => {
    requestTableDragging = false
    if (wrap) wrap.classList.remove('is-dragging')
    document.body.style.userSelect = '' // 恢复文本选择
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 监听请求日志变化，更新滚动条
watch(filteredRequestLogs, async () => {
  await nextTick()
  updateRequestTableScrollbarThumb()
  if (requestTableContent.value) {
    showRequestTableScrollbar()
  }
}, { deep: true })

// 从请求体中提取title参数
const getTitleFromRequestBody = (requestBody: string) => {
  if (!requestBody) return 'Unknown'

  try {
    const parsed = JSON.parse(requestBody)
    return parsed.title || 'Unknown'
  } catch (error) {
    return 'Unknown'
  }
}

// 截断标题字符串
const truncateTitle = (title: string) => {
  if (title.length <= 50) return title
  return title.substring(0, 47) + '...'
}

// 显示请求详情
const showRequestDetails = (log: RequestLog) => {
  selectedLog.value = log
  showLogDetails.value = true
  slideInActive.value = false
  activeModelTab.value = log.multiModelResponses?.[0]?.modelId || ''

  setTimeout(() => {
    slideInActive.value = true
  }, 10)
}

// 关闭请求详情
const closeRequestDetails = () => {
  slideInActive.value = false
  // 等待动画完成后再隐藏元素
  setTimeout(() => {
    showLogDetails.value = false
    selectedLog.value = null
  }, 300) // 与CSS动画时间一致
}

// 格式化JSON字符串
const formatJSON = (jsonString: string) => {
  try {
    const parsed = JSON.parse(jsonString)
    return JSON.stringify(parsed, null, 2)
  } catch (error) {
    return jsonString
  }
}

// 模拟添加一些示例数据（用于测试）
const addSampleLogs = () => {
  const sampleLogs = [
    {
      timestamp: Date.now() - 1000,
      method: 'GET',
      path: '/api/chat',
      status: 200,
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      responseTime: 245
    },
    {
      timestamp: Date.now() - 5000,
      method: 'POST',
      path: '/api/models',
      status: 201,
      ip: '192.168.1.100',
      userAgent: 'curl/7.68.0',
      responseTime: 89
    },
    {
      timestamp: Date.now() - 10000,
      method: 'GET',
      path: '/api/status',
      status: 404,
      ip: '127.0.0.1',
      userAgent: 'PostmanRuntime/7.29.0',
      responseTime: 12
    }
  ]

  sampleLogs.forEach(log => addRequestLog(log))
}

// 模型选择相关状态
const currentModel = ref<AIModel | null>(globalSelectedModel.value)

// 监听globalSelectedModel的变化，同步到currentModel
watch(globalSelectedModel, (newModel) => {
  console.log('globalSelectedModel变化:', newModel?.displayName || '无')
  currentModel.value = newModel
}, { immediate: true })

// 计算属性：获取平台名称
const getPlatformName = (platformId: string) => {
  const platform = platforms.value.find(p => p.id === platformId)
  return platform ? platform.displayName : '未知平台'
}

// Check if we're in Tauri environment - 简化检测逻辑
const isTauri = ref(false)

// 异步检测 Tauri 环境
const checkTauriEnvironment = async () => {
  try {
    // 尝试导入 Tauri API
    const { invoke } = await import('@tauri-apps/api/core')
    // 尝试调用一个简单的命令来确认 Tauri 可用
    await invoke('greet', { name: 'test' })
    isTauri.value = true
    console.log('Tauri 环境检测成功')
  } catch (error) {
    isTauri.value = false
    console.log('Tauri 环境检测失败:', error)
  }
}

// Server management functions
const getServerStatus = async () => {
  console.log('检查 Tauri 环境:', {
    isTauri: isTauri.value
  })

  if (!isTauri.value) {
    // Fallback for web environment
    console.log('不在 Tauri 环境中，使用默认状态')
    serverRunning.value = false
    serverUrl.value = ''
    serverPort.value = null
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const status = await invoke('get_server_status')
    serverRunning.value = (status as any).running
    serverUrl.value = (status as any).url || ''
    serverPort.value = (status as any).port
  } catch (error) {
    console.error('Failed to get server status:', error)
    // Fallback to default state if Tauri API is not available
    serverRunning.value = false
    serverUrl.value = ''
    serverPort.value = null
  }
}

const startServer = async () => {
  if (!isTauri.value) {
    alert('此功能仅在 Tauri 应用中可用')
    return
  }

  try {
    isToggling.value = true
    const { invoke } = await import('@tauri-apps/api/core')

    // 使用设置中的网络配置，确保绑定地址根据enableLanAccess状态正确设置
    const networkConfig = get('network')
    const bindAddress = networkConfig.enableLanAccess ? '0.0.0.0' : '127.0.0.1'

    const result = await invoke('start_server', {
      port: networkConfig.serverPort,
      webPort: networkConfig.webPort ?? 8080,
      bindAddress: bindAddress
    })

    serverRunning.value = (result as any).running
    serverUrl.value = (result as any).url || ''

    // 服务器启动成功后，启动SSE连接接收实时日志
    if ((result as any).running) {
      startSSEConnection()
    }

    console.log('Server started successfully:', result)
  } catch (error) {
    console.error('Failed to start server:', error)
    alert('启动服务器失败: ' + error)
  } finally {
    isToggling.value = false
  }
}

const stopServer = async () => {
  if (!isTauri.value) {
    alert('此功能仅在 Tauri 应用中可用')
    return
  }

  try {
    isToggling.value = true
    cancelAllInFlightModelRequests()
    stopSSEConnection()
    stopLogPolling()
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke('stop_server')

    serverRunning.value = (result as any).running
    serverUrl.value = (result as any).url || ''
    serverPort.value = (result as any).port

    console.log('Server stopped successfully:', result)
  } catch (error) {
    console.error('Failed to stop server:', error)
    alert('停止服务器失败: ' + error)
  } finally {
    isToggling.value = false
  }
}

const toggleServer = async () => {
  if (isToggling.value) return

  if (serverRunning.value) {
    await stopServer()
  } else {
    if ((!globalSelectedTextModels.value || globalSelectedTextModels.value.length === 0) && !settings.suppressNoModelWarning) {
      pendingStart.value = true
      showNoModelDialog.value = true
      return
    }
    await startServer()
  }
}

const openServerUrl = () => {
  if (serverUrl.value) {
    window.open(serverUrl.value, '_blank')
  }
}

const configurePort = () => {
  showPortDialog.value = true
}

const openOCSConfig = () => {
  showOCSConfig.value = true
}

// 暴露到全局，允许其他组件(如步骤条)打开 OCS 弹窗
onMounted(() => {
  window.addEventListener('open-ocs-config', openOCSConfig)
})

onUnmounted(() => {
  window.removeEventListener('open-ocs-config', openOCSConfig)
})

const testOCSConnection = async () => {
  try {
    const testUrl = `http://localhost:${serverPort.value}/query`
    console.log('测试OCS连接:', testUrl)

    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (response.ok) {
      console.log('OCS连接测试成功')
      // 这里可以添加成功提示
    } else {
      console.error('OCS连接测试失败:', response.status)
      // 这里可以添加失败提示
    }
  } catch (error) {
    console.error('OCS连接测试错误:', error)
    // 这里可以添加错误提示
  }
}

const openModelSelector = () => {
  showModelSelector.value = true
}

const openFolderPicker = () => {
  showFolderPicker.value = true
}

const handleFolderConfirm = async (folderId: number, folderName: string, folderPath: string) => {
  showFolderPicker.value = false
  set('questionSaveDir', folderPath || folderName)
  set('questionSaveFolderId', folderId)
  await save()
}

// 辅助方法：根据模型jsCode判断是否为思考模型，并通知后端

async function updateThinkingModelFlag(model: AIModel | null): Promise<void> {
  try {
    if (!isTauri.value) return
    const { invoke } = await import('@tauri-apps/api/core')
    const isThinking = !!model?.jsCode && model.jsCode.includes('reasoning_content')
    // 同时传入 is_thinking 与 isThinking，兼容不同后端参数命名
    await invoke('set_current_model_is_thinking', { is_thinking: isThinking, isThinking })
    console.log('已同步思考模型标志到后端:', isThinking)
  } catch (err) {
    console.warn('同步思考模型标志失败（可能非Tauri或服务未启动）:', err)
  }
}

const handlePortConfirm = async (newPort: number) => {
  const wasRunning = serverRunning.value

  // 如果服务器正在运行，先停止它
  if (wasRunning) {
    await stopServer()
  }

  // 保存到设置 - serverPort 现在是 computed，会自动响应设置变化
  set('network', {
    ...get('network'),
    serverPort: newPort
  })
  await save()

  // 如果之前服务器在运行，用新端口重新启动
  if (wasRunning) {
    await startServer()
  }

  showPortDialog.value = false
}

const toggleNetworkAccess = async () => {
  const newNetworkOpen = !networkOpen.value
  // 保存到设置
  set('network', {
    ...get('network'),
    enableLanAccess: newNetworkOpen,
    bindAddress: newNetworkOpen ? '0.0.0.0' : '127.0.0.1'
  })
  await save()
  const status = newNetworkOpen ? '开启' : '关闭'
  console.log(`局域网访问已${status}`)
}

// 模型选择相关方法
const selectModel = (model: any) => {
  const category = model.category || 'text'

  if (category === 'summary') {
    toggleSelectedSummaryModel(model.id)
  } else if (category === 'vision') {
    setSelectedVisionModel(model.id)
  } else {
    toggleSelectedTextModel(model.id)
  }
}

// 去除 markdown 代码块包裹（如 ```json\n...\n```）
const stripMarkdownCodeBlock = (content: string): string => {
  return content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '')
}

const getReasoningContentValue = (payload: any): string => {
  const candidates = [
    payload?.reasoning_content,
    payload?.reasoningContent,
    payload?.reasoning,
    payload?.delta?.reasoning_content,
    payload?.delta?.reasoningContent,
    payload?.delta?.reasoning,
    payload?.message?.reasoning_content,
    payload?.message?.reasoningContent,
    payload?.message?.reasoning,
    payload?.choices?.[0]?.delta?.reasoning_content,
    payload?.choices?.[0]?.delta?.reasoningContent,
    payload?.choices?.[0]?.delta?.reasoning,
    payload?.choices?.[0]?.message?.reasoning_content,
    payload?.choices?.[0]?.message?.reasoningContent,
    payload?.choices?.[0]?.message?.reasoning
  ]

  const reasoning = candidates.find(value => typeof value === 'string' && value.length > 0)
  return typeof reasoning === 'string' ? reasoning : ''
}

// 调用模型函数 - 支持流式显示
const callModelWithStreaming = async (

  model: AIModel,
  query: string,
  requestId: string,
  onChunk?: (content: string) => void,
  onReasoning?: (text: string) => void
) => {
  if (isRequestCancelled(requestId)) {
    throw createCancelledRequestError()
  }

  // 获取模型所属的平台
  const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))

  if (!platform) {
    console.error('未找到模型所属平台 - 详细信息:')
    console.error('- 模型ID:', model.id)
    console.error('- 模型平台ID:', model.platformId)
    console.error('- 所有平台:', platforms.value.map(p => ({
      id: p.id,
      name: p.displayName,
      modelIds: p.models.map(m => m.id)
    })))
    throw new Error('未找到模型所属平台')
  }

  // 构建测试输入数据
  const testInput = {
    messages: [
      {
        role: 'user',
        content: query
      }
    ],
    model: model.id,
    stream: true
  }

  // 构建配置对象
  const config = {
    apiKey: platform.apiKey,
    baseUrl: platform.baseUrl,
    model: model.id,
    ...model
  }

  // 读取超时配置（秒转毫秒）
  const { settings: appSettings } = useSettings()
  const timeoutMs = (appSettings.modelResponseTimeout ?? 40) * 1000

  // AbortController 用于超时中断 fetch
  const abortController = new AbortController()
  registerAbortController(requestId, abortController)
  const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs)

  const tauriHttp = await import('@tauri-apps/plugin-http')
  const tauriFetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
    tauriHttp.fetch(input as any, {
      ...init,
      credentials: init.credentials ?? 'include',
      signal: init.signal ?? abortController.signal
    } as any)

  // 执行JavaScript配置代码
  if (model.jsCode) {
    // 创建一个安全的执行环境
    let executableCode = model.jsCode.trim()
    let processModel

    if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
      const safeEval = new Function('input', 'config', 'fetch', 'abortSignal', `
        ${executableCode}
        return processModel;
      `)
      processModel = safeEval(testInput, config, tauriFetch, abortController.signal)
    } else {
      const wrapperFunction = new Function('input', 'config', 'fetch', 'abortSignal', `
        return (async function processModel(input, config) {
          ${executableCode}
        });
      `)
      processModel = wrapperFunction(testInput, config, tauriFetch, abortController.signal)
    }

    try {
      // 执行模型调用
      const result = await processModel(testInput, config, abortController.signal)

      if (result) {
        // 如果返回的是生成器或异步迭代器，进行流式处理
        if (result[Symbol.asyncIterator]) {
          let fullResponse = ''
          let fullReasoning = ''
          // 进度发送节流：每800ms向后端发送一次进度心跳
          let lastProgressSentAt = 0
          for await (const chunk of result) {
            if (chunk.content) {
              fullResponse += chunk.content
              // 实时更新UI显示
              if (onChunk) {
                onChunk(fullResponse)
              } else {
                updateStreamingResponse(requestId, fullResponse)
              }
              const now = Date.now()
              if (now - lastProgressSentAt > 800) {
                sendModelProgressToBackend(requestId, fullResponse)
                lastProgressSentAt = now
              }
            }
            const rc = getReasoningContentValue(chunk)
            if (rc) {
              fullReasoning += rc
              if (onReasoning) {
                onReasoning(fullReasoning)
              } else {
                updateStreamingReasoning(requestId, fullReasoning)
              }
            }
          }
          if (fullReasoning) {
            if (onReasoning) {
              onReasoning(fullReasoning)
            } else {
              updateRequestDetailsWithModelReasoning(requestId, fullReasoning)
            }
          }
          return fullResponse
        } else {
          // 非流式响应，直接返回
          const response = typeof result === 'string'
            ? result
            : typeof result?.content === 'string'
              ? result.content
              : JSON.stringify(result)
          const reasoning = typeof result === 'string' ? '' : getReasoningContentValue(result)

          if (reasoning) {
            if (onReasoning) {
              onReasoning(reasoning)
            } else {
              updateStreamingReasoning(requestId, reasoning)
            }
          }
          if (onChunk) {
            onChunk(response)
          } else {
            updateStreamingResponse(requestId, response)
          }
          return response
        }

      } else {
        throw new Error('模型配置代码未返回有效结果')
      }
    } finally {
      clearTimeout(timeoutHandle)
      unregisterAbortController(requestId, abortController)
    }
  } else {
    clearTimeout(timeoutHandle)
    unregisterAbortController(requestId, abortController)
    throw new Error('模型未配置JavaScript代码')
  }
}

// 更新流式响应显示
const updateStreamingResponse = (requestId: string, content: string) => {
  const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
  if (logIndex !== -1) {
    requestLogs.value[logIndex].modelResponse = content
  }
}

// 更新流式思考过程显示
const updateStreamingReasoning = (requestId: string, reasoning: string) => {
  const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
  if (logIndex !== -1) {
    requestLogs.value[logIndex].streamingReasoning = reasoning
  }
}

// 更新多模型模式下某个模型的流式响应
const updateMultiModelStreamingResponse = (requestId: string, modelId: string, content: string) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log || !log.multiModelResponses) return
  const entry = log.multiModelResponses.find(r => r.modelId === modelId)
  if (entry) entry.response = content
}

// 更新多模型模式下某个模型的流式思考过程
const updateMultiModelStreamingReasoning = (requestId: string, modelId: string, reasoning: string) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log || !log.multiModelResponses) return
  const entry = log.multiModelResponses.find(r => r.modelId === modelId)
  if (entry) {
    entry.streamingReasoning = reasoning
  }
}

const finalizeMultiModelReasoning = (requestId: string, modelId: string) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log || !log.multiModelResponses) return
  const entry = log.multiModelResponses.find(r => r.modelId === modelId)
  if (!entry) return

  const finalReasoning = (entry.reasoningContent || entry.streamingReasoning || '').trim()
  entry.reasoningContent = finalReasoning
  entry.streamingReasoning = ''
}



// 调用模型函数
const callModel = async (model: AIModel, query: string) => {
  // 获取模型所属的平台
  const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
  if (!platform) {
    throw new Error('未找到模型所属平台')
  }

  // 构建测试输入数据
  const testInput = {
    messages: [
      {
        role: 'user',
        content: query
      }
    ],
    model: model.id,
    stream: true
  }

  // 构建配置对象
  const config = {
    apiKey: platform.apiKey,
    baseUrl: platform.baseUrl,
    model: model.id,
    ...model
  }

  const tauriHttp = await import('@tauri-apps/plugin-http')
  const tauriFetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
    tauriHttp.fetch(input as any, {
      ...init,
      credentials: init.credentials ?? 'include'
    } as any)

  // 执行JavaScript配置代码
  if (model.jsCode) {
    // 创建一个安全的执行环境
    let executableCode = model.jsCode.trim()
    let processModel

    if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
      // 如果是完整的函数声明，使用eval在安全环境中执行
      const safeEval = new Function('input', 'config', 'fetch', `
        ${executableCode}
        return processModel;
      `)
      processModel = safeEval(testInput, config, tauriFetch)
    } else {
      // 如果是函数体，包装为async函数
      const wrapperFunction = new Function('input', 'config', 'fetch', `
        return (async function processModel(input, config) {
          ${executableCode}
        });
      `)
      processModel = wrapperFunction(testInput, config, tauriFetch)
    }

    // 执行模型调用
    const result = await processModel(testInput, config)

    if (result) {
      // 如果返回的是生成器或异步迭代器，收集结果
      if (result[Symbol.asyncIterator]) {
        let fullResponse = ''
        for await (const chunk of result) {
          if (chunk.content) {
            fullResponse += chunk.content
          }
        }
        return fullResponse
      } else {
        return result
      }
    } else {
      throw new Error('模型配置代码未返回有效结果')
    }
  } else {
    throw new Error('模型未配置JavaScript代码')
  }
}

// Lifecycle
onMounted(async () => {
  // 初始化服务器端口为配置端口
  serverPort.value = configuredPort.value

  // 首先检测 Tauri 环境
  await checkTauriEnvironment()

  // 检测完成后，同步当前模型的思考标志到后端
  await updateThinkingModelFlag(currentModel.value)

  // 然后获取服务器状态
  setTimeout(async () => {
    await getServerStatus()
    // 获取服务器状态后，如果服务器正在运行，则启动SSE连接接收实时日志
    if (serverRunning.value) {
      startSSEConnection()
    }
  }, 100)

  // 初始化当前选中的模型
  currentModel.value = globalSelectedModel.value

  // 如果不在Tauri环境中，添加示例请求记录（用于测试）
  if (!isTauri.value) {
    addSampleLogs()
  }
})

// 监听全局选中模型的变化，同步更新本地状态
watch(globalSelectedModel, (newModel) => {
  if (newModel) {
    currentModel.value = newModel
    console.log('全局模型已更新:', newModel.displayName)
    // 同步更新后端思考模型标志
    updateThinkingModelFlag(newModel)
  }
}, { immediate: false })

// 单个模型调用，独立日志条目，返回响应文本
const callSingleModelAPI = async (model: AIModel, query: string, logId: string): Promise<string> => {
  const logIndex = requestLogs.value.findIndex(log => log.id === logId)
  if (logIndex !== -1) {
    requestLogs.value[logIndex].isModelCalling = true
    requestLogs.value[logIndex].modelResponse = ''
    requestLogs.value[logIndex].streamingReasoning = ''
    requestLogs.value[logIndex].reasoningContent = ''
    const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
    if (platform) {
      requestLogs.value[logIndex].modelInfo = {
        platformName: platform.displayName,
        modelName: model.displayName,
        modelId: model.id
      }
    }
    if (serverRunning.value && serverUrl.value && !heartbeatIntervals.has(logId)) {
      const timerId = window.setInterval(() => {
        try {
          const currentContent = requestLogs.value[requestLogs.value.findIndex(l => l.id === logId)]?.modelResponse || ''
          sendModelProgressToBackend(logId, currentContent)
        } catch (e) { /* ignore */ }
      }, 1000)
      heartbeatIntervals.set(logId, timerId)
    }
  }

  try {
    const response = await callModelWithStreaming(model, query, logId)
    const idx = requestLogs.value.findIndex(l => l.id === logId)
    if (idx !== -1) requestLogs.value[idx].isModelCalling = false
    clearRequestHeartbeat(logId)
    return response
  } catch (error) {
    if (isAbortLikeError(error) || isRequestCancelled(logId)) {
      clearRequestHeartbeat(logId)
      return MODEL_REQUEST_CANCELLED_MESSAGE
    }
    const errorMessage = error instanceof Error ? error.message : '模型调用失败'
    const errText = `错误: ${errorMessage}`
    const idx = requestLogs.value.findIndex(l => l.id === logId)
    if (idx !== -1) {
      requestLogs.value[idx].modelResponse = errText
      requestLogs.value[idx].isModelCalling = false
    }
    clearRequestHeartbeat(logId)
    return errText
  }
}

// 调用模型API（支持多模型并发）
const callModelAPI = async (requestId: string, query: string) => {
  let finalOutput = ''
  console.log('开始调用模型API:', { requestId, query })

  try {
    // 只有文本模型参与基础输出；视觉模型仅在 query 包含图片时才加入
    const hasImage = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)/i.test(query) || query.includes('base64')
    const selectedModels = [...globalSelectedTextModels.value]
    if (hasImage && globalSelectedVisionModel.value) {
      selectedModels.push(globalSelectedVisionModel.value)
    }

    if (selectedModels.length === 0) {
      const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
      const errorText = '错误: 未选择模型'
      if (logIndex !== -1) requestLogs.value[logIndex].modelResponse = errorText
      await sendModelResponseToBackend(requestId, errorText, false)
      return
    }

    const logIndex = requestLogs.value.findIndex(l => l.id === requestId)

    // --- 阶段 1: 基础模型调用 (Base Model Phase) ---
    if (logIndex !== -1) {
      requestLogs.value[logIndex].isModelCalling = true
      requestLogs.value[logIndex].modelResponse = undefined
      requestLogs.value[logIndex].streamingReasoning = undefined
      requestLogs.value[logIndex].reasoningContent = undefined
      requestLogs.value[logIndex].modelInfo = undefined

      // 初始化多模型响应数组
      requestLogs.value[logIndex].multiModelResponses = selectedModels.map(model => {
        const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
        return {
          modelId: model.id,
          modelName: model.displayName,
          platformName: platform?.displayName || '未知平台',
          response: '',
          streamingReasoning: '',
          reasoningContent: '',
          isLoading: true
        } as MultiModelResponse
      })
    }

    // 启动心跳
    if (serverRunning.value && serverUrl.value && !heartbeatIntervals.has(requestId)) {
      const timerId = window.setInterval(() => {
        try {
          const log = requestLogs.value.find(l => l.id === requestId)
          if (log?.multiModelResponses) {
            const currentContent = log.multiModelResponses
              .map(r => `[${r.modelName}]\n${r.response}`).join('\n\n')
            sendModelProgressToBackend(requestId, currentContent)
          }
        } catch (e) { /* ignore */ }
      }, 1000)
      heartbeatIntervals.set(requestId, timerId)
    }

    // 并发调用基础模型
    const results = await Promise.all(
      selectedModels.map(async (model) => {
        try {
          const response = await callModelWithStreaming(
            model,
            query,
            requestId,
            (content) => updateMultiModelStreamingResponse(requestId, model.id, stripMarkdownCodeBlock(content)),
            (reasoning) => updateMultiModelStreamingReasoning(requestId, model.id, reasoning)
          )
          const strippedResponse = stripMarkdownCodeBlock(response)
          const log = requestLogs.value.find(l => l.id === requestId)
          if (log?.multiModelResponses) {
            const entry = log.multiModelResponses.find(r => r.modelId === model.id)
            if (entry) { entry.isLoading = false; entry.response = strippedResponse }
          }
          finalizeMultiModelReasoning(requestId, model.id)
          return strippedResponse

        } catch (error) {
          if (isAbortLikeError(error) || isRequestCancelled(requestId)) {
            throw createCancelledRequestError()
          }
          const errText = `错误: ${error instanceof Error ? error.message : '模型调用失败'}`
          const log = requestLogs.value.find(l => l.id === requestId)
          if (log?.multiModelResponses) {
            const entry = log.multiModelResponses.find(r => r.modelId === model.id)
            if (entry) { entry.isLoading = false; entry.response = errText }
          }
          return errText
        }
      })
    )

    if (isRequestCancelled(requestId)) return

    // --- 阶段 2: 汇总与总结 (Summary Phase) ---
    const summaryModels = globalSelectedSummaryModels.value

    // 过滤掉失败的基础模型结果，只用成功的部分做总结
    const successfulResults = results.filter(r => !r.startsWith('错误:'))
    const successfulModels = selectedModels.filter((_, i) => !results[i].startsWith('错误:'))

    const baseCombinedResponse = successfulModels.length === 1
      ? successfulResults[0]
      : successfulModels.map((model, i) => `[${model.displayName}]\n${successfulResults[i]}`).join('\n\n')

    if (summaryModels.length > 0 && successfulResults.length > 0) {
      console.log('开始总结阶段:', summaryModels.map(m => m.displayName))

      // 在日志中添加总结模型的占位项（如果尚未在多模型数组中）
      const log = requestLogs.value.find(l => l.id === requestId)
      if (log) {
        if (!log.multiModelResponses) {
          log.multiModelResponses = []
        }

        // 避免重复添加（针对可能的并发重试）
        const existingIds = new Set(log.multiModelResponses.map(r => r.modelId))
        summaryModels.forEach(model => {
          const summaryKey = `summary:${model.id}`
          if (!existingIds.has(summaryKey)) {
            const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
            log.multiModelResponses!.push({
              modelId: summaryKey,
              modelName: `总结: ${model.displayName}`,
              platformName: platform?.displayName || '未知平台',
              response: '',
              streamingReasoning: '',
              reasoningContent: '',
              isLoading: true
            })
          }
        })
      }

      const summaryQuery = `你是一个总结专家。下面是用户的问题以及AI模型的回答。请根据回答内容，整理并总结出一个最准确、最全面的最终答案。

用户原始问题：
${query}

模型回答内容：
${baseCombinedResponse}

请直接给出最终总结答案：`

      const summaryResults = await Promise.all(
        summaryModels.map(async (model) => {
          const summaryKey = `summary:${model.id}`
          try {
            const response = await callModelWithStreaming(
              model,
              summaryQuery,
              requestId,
              (content) => updateMultiModelStreamingResponse(requestId, summaryKey, stripMarkdownCodeBlock(content)),
              (reasoning) => updateMultiModelStreamingReasoning(requestId, summaryKey, reasoning)
            )
            const strippedResponse = stripMarkdownCodeBlock(response)
            const l = requestLogs.value.find(l => l.id === requestId)
            if (l?.multiModelResponses) {
              const entry = l.multiModelResponses.find(r => r.modelId === summaryKey)
              if (entry) { entry.isLoading = false; entry.response = strippedResponse }
            }
            finalizeMultiModelReasoning(requestId, summaryKey)
            return strippedResponse

          } catch (error) {
            if (isAbortLikeError(error) || isRequestCancelled(requestId)) {
              throw createCancelledRequestError()
            }
            const errText = `错误: ${error instanceof Error ? error.message : '总结失败'}`
            const l = requestLogs.value.find(l => l.id === requestId)
            if (l?.multiModelResponses) {
              const entry = l.multiModelResponses.find(r => r.modelId === summaryKey)
              if (entry) { entry.isLoading = false; entry.response = errText }
            }
            return errText
          }
        })
      )

      if (isRequestCancelled(requestId)) return

      finalOutput = summaryModels.length === 1
        ? summaryResults[0]
        : summaryModels.map((m, i) => `[${m.displayName} 总结]\n${summaryResults[i]}`).join('\n\n')

      const finalReasoning = summaryModels.length === 1
        ? getRequestReasoningForBackend(requestId, `summary:${summaryModels[0].id}`)
        : ''
      if (!isRequestCancelled(requestId)) {
        await sendModelResponseToBackend(requestId, finalOutput, !finalOutput.startsWith('错误:'), finalReasoning)
      }
    } else {
      // 无总结模型或全部基础模型失败，直接发送基础结果
      const fallbackResponse = selectedModels.length === 1
        ? results[0]
        : selectedModels.map((model, i) => `[${model.displayName}]\n${results[i]}`).join('\n\n')
      finalOutput = fallbackResponse
      const finalReasoning = selectedModels.length === 1
        ? getRequestReasoningForBackend(requestId, selectedModels[0].id)
        : ''
      if (!isRequestCancelled(requestId)) {
        await sendModelResponseToBackend(requestId, finalOutput, successfulResults.length > 0, finalReasoning)
      }
    }
  } catch (error) {
    if (isAbortLikeError(error) || isRequestCancelled(requestId)) {
      return
    }

    const errorMessage = error instanceof Error ? error.message : '模型调用失败'
    const errorText = `错误: ${errorMessage}`
    const log = requestLogs.value.find(l => l.id === requestId)
    if (log) {
      log.modelResponse = errorText
      log.isModelCalling = false
    }

    if (serverRunning.value && serverUrl.value) {
      await sendModelResponseToBackend(requestId, errorText, false)
    }
  } finally {
    const finalLogIdx = requestLogs.value.findIndex(l => l.id === requestId)
    if (finalLogIdx !== -1) {
      requestLogs.value[finalLogIdx].isModelCalling = false
      if (finalOutput && !isRequestCancelled(requestId)) {
        requestLogs.value[finalLogIdx].modelResponse = finalOutput
      }
    }
    clearRequestHeartbeat(requestId)
    cancelledRequestIds.delete(requestId)
  }
}

const handleNoModelStillOpen = (dontRemind: boolean) => {
  if (dontRemind) {
    set('suppressNoModelWarning', true)
    save()
  }
  showNoModelDialog.value = false
  if (pendingStart.value) {
    pendingStart.value = false
    startServer()
  }
}
const handleNoModelSelect = (dontRemind: boolean) => {
  if (dontRemind) {
    set('suppressNoModelWarning', true)
    save()
  }
  showNoModelDialog.value = false
  showModelSelector.value = true
}

watch(globalSelectedTextModels, (newModels) => {
  if (newModels && newModels.length > 0 && pendingStart.value) {
    pendingStart.value = false
    startServer()
  }
})

const finalModelResponseState = new Map<string, 'success' | 'error'>()

const getRequestReasoningForBackend = (requestId: string, modelId?: string): string => {
  const log = requestLogs.value.find(entry => entry.id === requestId)
  if (!log) return ''

  if (modelId && log.multiModelResponses) {
    const target = log.multiModelResponses.find(entry => entry.modelId === modelId)
    return (target?.reasoningContent || target?.streamingReasoning || '').trim()
  }

  if (log.reasoningContent || log.streamingReasoning) {
    return (log.reasoningContent || log.streamingReasoning || '').trim()
  }

  if (log.multiModelResponses?.length === 1) {
    const onlyEntry = log.multiModelResponses[0]
    return (onlyEntry.reasoningContent || onlyEntry.streamingReasoning || '').trim()
  }

  return ''
}

// 发送模型响应到后端
const sendModelResponseToBackend = async (requestId: string, content: string, isSuccess: boolean = true, reasoningContent = '') => {
  const existingState = finalModelResponseState.get(requestId)
  if (existingState === 'success') {
    console.warn('忽略重复的模型最终响应（已成功发送）:', { requestId, isSuccess })
    return
  }
  if (existingState === 'error' && !isSuccess) {
    console.warn('忽略重复的模型错误响应:', { requestId })
    return
  }

  try {
    const response = await fetch(`${serverUrl.value}/api/model/response`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: requestId,
        content: content,
        reasoning_content: reasoningContent || undefined,
        is_success: isSuccess
      })
    })


    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    finalModelResponseState.set(requestId, isSuccess ? 'success' : 'error')
    console.log('模型响应已发送到后端:', { requestId, content, reasoningContent, isSuccess })

    // 只有在成功调用模型时才存储AI响应到数据库
    if (isSuccess) {
      // 2024-05-21: 禁用前端存储以防止重复条目。
      // 后端 (server.rs) 在从前端接收到响应后已经执行了存储操作。
      // await storeAIResponseToDatabase(requestId, content)
      console.log('前端跳过存储AI响应 (已由后端处理):', { requestId })
    } else {
      console.log('AI调用失败，跳过保存到数据库:', { requestId, content })
    }

  } catch (error) {
    console.error('发送模型响应到后端失败:', error)
  }
}


// 发送模型进度到后端（用于流式输出期间的活跃心跳）
const sendModelProgressToBackend = async (requestId: string, content: string) => {
  try {
    const response = await fetch(`${serverUrl.value}/api/model/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: requestId,
        content: content
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
  } catch (error) {
    console.warn('发送模型进度到后端失败（忽略）:', error)
  }
}

// 存储AI响应到数据库
const storeAIResponseToDatabase = async (requestId: string, content: string) => {
  try {
    // 从请求日志中找到对应的请求，获取实际的title, options, type
    const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
    let title = 'Unknown'
    let options = ''
    let type = ''

    if (logIndex !== -1) {
      const log = requestLogs.value[logIndex]
      // 从请求体中提取参数
      if (log.requestBody) {
        try {
          const parsed = JSON.parse(log.requestBody)
          title = parsed.title || 'Unknown'
          options = parsed.options || ''
          type = parsed.type || ''
        } catch (e) {
          console.error('解析请求体失败:', e)
        }
      }
    }

    // 从AI响应中提取答案（稳健处理混合文本）
    let extractedAnswer = content
    const cleanedContent = content
      .trim()
      .replace(/^```json\s*/, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/, '')
      .trim()

    console.log('🔍 清理后的内容:', cleanedContent)

    const extractAnswerFromMixedContent = (text: string): string => {
      // 尝试直接解析为JSON
      try {
        const obj = JSON.parse(text)
        if (obj && typeof obj === 'object') {
          if (typeof obj.answer === 'string') {
            console.log('✅ 直接解析文本为JSON并提取到答案:', obj.answer)
            return obj.answer
          }
          if (typeof obj.anwser === 'string') {
            console.log('✅ 直接解析文本为JSON并提取到anwser(拼写错误):', obj.anwser)
            return obj.anwser
          }
        }
      } catch { }

      // 从末尾提取最后一个平衡的JSON对象
      const extractLastBalancedJson = (s: string): string | null => {
        let end = -1
        let depth = 0
        for (let i = s.length - 1; i >= 0; i--) {
          const ch = s[i]
          if (end === -1) {
            if (ch === '}') {
              end = i
              depth = 1
              continue
            }
          } else {
            if (ch === '}') {
              depth++
            } else if (ch === '{') {
              depth--
              if (depth === 0) {
                const candidate = s.slice(i, end + 1)
                return candidate
              }
            }
          }
        }
        return null
      }

      const jsonStr = extractLastBalancedJson(text)
      if (jsonStr) {
        console.log('🔎 发现末尾的JSON片段:', jsonStr)
        try {
          const obj = JSON.parse(jsonStr)
          if (typeof obj.answer === 'string') {
            console.log('✅ 从末尾JSON片段中提取到答案:', obj.answer)
            return obj.answer
          }
          if (typeof obj.anwser === 'string') {
            console.log('✅ 从末尾JSON片段中提取到anwser(拼写错误):', obj.anwser)
            return obj.anwser
          }
        } catch (e) {
          console.log('⚠️ 末尾JSON片段解析失败:', e)
        }
      }

      // 正则回退，直接在文本中匹配 answer 字段
      const regex = /\{\s*"(?:answer|anwser)"\s*:\s*"([^"]+)"[\s\S]*?\}/s
      const m = text.match(regex)
      if (m && m[1]) {
        console.log('✅ 通过正则从混合文本中捕获到答案:', m[1])
        return m[1]
      }

      console.log('⚠️ 未能提取到结构化答案，回退为原始内容')
      return text
    }

    extractedAnswer = extractAnswerFromMixedContent(cleanedContent).trim()

    if (!extractedAnswer) {
      console.warn('⚠️ AI最终处理结果答案为空，跳过保存题目', { requestId, title })
      return
    }

    // 使用数据库服务存储AI响应
    await databaseService.addQuestion({
      content: title, // 使用实际的请求title
      options: options, // 使用请求中的options
      answer: extractedAnswer, // 使用解析后的答案
      question_type: type, // 使用请求中的type
      folderId: 0, // 存储到ID为0的文件夹
      isAi: 1 // 标记为AI生成的题目
    })

    console.log('✅ AI响应已成功存储到数据库:', { requestId, title, extractedAnswer, contentLength: extractedAnswer.length })

  } catch (error) {
    console.error('❌ 存储AI响应到数据库失败:', error)
  }
}

// 更新请求详情中的模型响应
const updateRequestDetailsWithModelResponse = (requestId: string, content: string) => {
  console.log('更新请求详情中的模型响应:', { requestId, content })

  // 找到对应的请求记录并更新模型响应
  const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
  if (logIndex !== -1) {
    const log = requestLogs.value[logIndex]
    log.modelResponse = content
    log.isModelCalling = false

    if (log.multiModelResponses?.length === 1) {
      log.multiModelResponses[0].response = content
      log.multiModelResponses[0].isLoading = false
    }

    console.log('请求记录已更新:', log)
  }
}

// 更新请求详情中的思考过程（最终）
const updateRequestDetailsWithModelReasoning = (requestId: string, reasoning: string) => {
  console.log('更新请求详情中的模型思考过程:', { requestId, reasoning })
  const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
  if (logIndex !== -1) {
    const log = requestLogs.value[logIndex]
    log.reasoningContent = reasoning
    log.streamingReasoning = ''

    if (log.multiModelResponses?.length === 1) {
      log.multiModelResponses[0].reasoningContent = reasoning
      log.multiModelResponses[0].streamingReasoning = ''
      log.multiModelResponses[0].isLoading = false
    }

    console.log('请求记录思考过程已更新:', log)
  }
}


// 已处理的请求ID集合，用于避免重复处理
const processedRequestIds = new Set<string>()
const activeUrlAnalysisRequestIds = new Set<string>()

// 处理 URL 题目请求（由 SSE model_call_request 事件触发）
const handleUrlQuestionRequest = async (requestId: string, rawTitle: string) => {
  if (processedRequestIds.has(requestId)) return
  processedRequestIds.add(requestId)

  // 解析 title 和内嵌的 __OPTIONS__: 字段
  let title = rawTitle
  let originalOptions = ''
  const optionsMarker = '\n__OPTIONS__:'
  const optIdx = rawTitle.indexOf(optionsMarker)
  if (optIdx !== -1) {
    title = rawTitle.slice(0, optIdx)
    originalOptions = rawTitle.slice(optIdx + optionsMarker.length)
  }

  // 如果 query 里没有 options，从请求日志的 requestBody 中补充
  if (!originalOptions) {
    const matchedLog = requestLogs.value.find(l => l.id === requestId)
    if (matchedLog?.requestBody) {
      try {
        const rb = JSON.parse(matchedLog.requestBody)
        originalOptions = rb.options || ''
      } catch (e) { }
    }
  }

  // 在对应 log 上标记为 URL 题目，在详情面板内处理
  // SSE model_call_request 可能比 started 日志事件更早到达，需要重试等待 log 出现
  const urlQuestionData: NonNullable<RequestLog['urlQuestion']> = {

    title,
    options: originalOptions,
    imageUrl: null as string | null,
    analyzing: false,
    analysisResult: null as string | null,
    analysisError: '',
    streamingResponse: '',
    streamingReasoning: '',
    reasoningContent: '',
    renderedHtml: undefined as string | undefined
  }


  const applyAndAnalyze = () => {
    const logIndex = requestLogs.value.findIndex(l => l.id === requestId)
    if (logIndex !== -1) {
      requestLogs.value[logIndex].urlQuestion = { ...urlQuestionData }
      // 异步生成 base64 渲染 HTML
      buildRenderedHtml(title, originalOptions).then(html => {
        const l = requestLogs.value.find(l => l.id === requestId)
        if (l?.urlQuestion) l.urlQuestion.renderedHtml = html
      })
      requestLogs.value[logIndex].isModelCalling = true

      // 如果当前正在查看该请求，切换到 modelResponse tab
      if (selectedLog.value?.id === requestId) {
        activeTab.value = 'modelResponse'
      }

      // 直接触发视觉分析
      analyzeUrlQuestion(requestId)
    } else {
      // log 还未到达，100ms 后重试，最多重试 30 次（3 秒）
      let retries = 0
      const timer = setInterval(() => {
        retries++
        const idx = requestLogs.value.findIndex(l => l.id === requestId)
        if (idx !== -1) {
          clearInterval(timer)
          requestLogs.value[idx].urlQuestion = { ...urlQuestionData }
          buildRenderedHtml(title, originalOptions).then(html => {
            const l = requestLogs.value.find(l => l.id === requestId)
            if (l?.urlQuestion) l.urlQuestion.renderedHtml = html
          })
          requestLogs.value[idx].isModelCalling = true
          if (selectedLog.value?.id === requestId) {
            activeTab.value = 'modelResponse'
          }
          analyzeUrlQuestion(requestId)
        } else if (retries >= 30) {
          clearInterval(timer)
          console.warn('handleUrlQuestionRequest: log 未在 3 秒内出现，放弃:', requestId)
          void sendModelResponseToBackend(requestId, '错误: 未找到对应请求日志，无法处理 URL 题目', false)
        }
      }, 100)
    }
  }


  applyAndAnalyze()
}

// 检查并显示URL处理弹窗
const checkAndShowUrlDialog = async (log: RequestLog) => {
  try {
    // 检查是否已经处理过这个请求
    if (processedRequestIds.has(log.id)) {
      console.log('⚠️ 请求已处理过，跳过:', log.id)
      return
    }

    // 解析响应体
    if (log.responseBody) {
      const responseData = JSON.parse(log.responseBody)

      // 检查是否是URL检测响应
      if (responseData.code === 1 &&
        responseData.data &&
        (
          // data 是对象的情况
          (responseData.data.answer === '题目中含有URL，无法直接展示') ||
          // data 是数组的情况
          (Array.isArray(responseData.data) && responseData.data[0]?.answer === '题目中含有URL，无法直接展示')
        )) {

        // 标记请求为已处理
        processedRequestIds.add(log.id)

        // 从请求体中提取原始问题和选项
        let originalQuestion = ''
        let originalOptions = ''

        if (log.requestBody) {
          try {
            const requestData = JSON.parse(log.requestBody)
            originalQuestion = requestData.title || ''
            originalOptions = requestData.options || ''
          } catch (e) {
            console.error('解析请求体失败:', e)
          }
        }

        // 构建题目数据结构
        const questionData = {
          id: `question_${Date.now()}_${log.id}`, // 包含请求ID确保唯一性
          title: originalQuestion,
          options: originalOptions,
          timestamp: new Date().toLocaleString(),
          status: 'pending', // pending, processing, completed
          requestId: log.id, // 保存原始请求ID
          isNew: true // 标记为新题目
        }

        // 检查是否已有URL内容窗口打开
        const existingQuestions = getExistingQuestions()

        // 将新题目添加到列表开头，让最新题目显示在最上方
        existingQuestions.unshift(questionData)

        console.log('✅ 添加新题目到列表顶部:', {
          questionData,
          totalQuestions: existingQuestions.length
        })

        // 保存题目数据到本地存储（先保存，确保数据不丢失）
        saveQuestionsToStorage(existingQuestions)

        // 尝试检查窗口是否已存在
        let windowExists = false
        try {
          const { invoke } = await import('@tauri-apps/api/core')

          // 先尝试检查窗口是否存在
          try {
            const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')

            // 方法1: 尝试直接获取窗口实例
            let existingWindow = null
            try {
              // getByLabel 可能返回 Promise，需要正确处理
              const windowResult = WebviewWindow.getByLabel('url-content')
              console.log('🔍 getByLabel结果:', windowResult)
              console.log('🔍 窗口对象类型:', typeof windowResult)

              // 检查是否是 Promise
              if (windowResult && typeof windowResult.then === 'function') {
                console.log('🔍 getByLabel返回Promise，等待解析...')
                existingWindow = await windowResult
              } else {
                existingWindow = windowResult
              }

              console.log('🔍 解析后的窗口对象:', existingWindow)
              console.log('🔍 窗口对象属性:', Object.keys(existingWindow || {}))
            } catch (getLabelError) {
              console.log('🔍 getByLabel失败:', getLabelError)
            }

            if (existingWindow) {
              console.log('✅ 检测到已存在的URL内容窗口')

              // 检查窗口是否真的可用 - 使用更全面的方法
              let windowIsUsable = false
              try {
                console.log('🔍 开始检查窗口可用性')
                console.log('🔍 existingWindow.label:', existingWindow.label)
                console.log('🔍 existingWindow.label类型:', typeof existingWindow.label)

                // 方法1: 检查基本属性
                if (typeof existingWindow.label === 'string') {
                  console.log('✅ 窗口基本属性可用，标签:', existingWindow.label)

                  // 方法2: 尝试检查窗口状态（如果方法存在）
                  let statusChecked = false
                  try {
                    console.log('🔍 检查isVisible方法:', typeof existingWindow.isVisible)
                    if (existingWindow.isVisible) {
                      const isVisible = await existingWindow.isVisible()
                      console.log('✅ 窗口可见状态:', isVisible)
                      statusChecked = true
                    }
                  } catch (visibilityError) {
                    console.log('⚠️ 无法检查窗口可见性，但窗口可能仍然可用:', visibilityError)
                  }

                  // 方法3: 尝试检查窗口是否最小化（如果方法存在）
                  try {
                    console.log('🔍 检查isMinimized方法:', typeof existingWindow.isMinimized)
                    if (existingWindow.isMinimized) {
                      const isMinimized = await existingWindow.isMinimized()
                      console.log('✅ 窗口最小化状态:', isMinimized)
                      statusChecked = true
                    }
                  } catch (minimizedError) {
                    console.log('⚠️ 无法检查窗口最小化状态:', minimizedError)
                  }

                  // 如果基本属性可用，就认为窗口可用
                  windowIsUsable = true
                  console.log('✅ 窗口被认定为可用')
                } else {
                  console.log('❌ 窗口基本属性不可用，label:', existingWindow.label, '类型:', typeof existingWindow.label)
                }
              } catch (testError) {
                console.log('🔍 窗口可用性检查异常:', testError)
              }

              if (windowIsUsable) {
                windowExists = true

                // 窗口已存在，通过事件通信来更新数据
                try {
                  // 方法1: 通过事件发送新题目数据
                  const { emit } = await import('@tauri-apps/api/event')
                  await emit('new-question-added', {
                    windowId: currentUrlWindowId.value,
                    questions: existingQuestions,
                    latestQuestion: questionData
                  })

                  // 尝试聚焦到窗口
                  try {
                    if (existingWindow.setFocus) {
                      await existingWindow.setFocus()
                    } else {
                      console.log('⚠️ setFocus方法不可用，跳过聚焦')
                    }
                  } catch (focusError) {
                    console.log('⚠️ 聚焦窗口失败:', focusError)
                  }

                  console.log('✅ 已通过事件更新现有窗口的题目数据:', {
                    totalQuestions: existingQuestions.length,
                    latestQuestion: questionData
                  })

                  return // 成功更新，直接返回
                } catch (eventError) {
                  console.error('❌ 事件通信失败，尝试关闭并重新创建窗口:', eventError)

                  // 方法2: 关闭现有窗口并重新创建
                  try {
                    if (existingWindow.close) {
                      await existingWindow.close()
                    } else {
                      console.log('⚠️ close方法不可用，无法关闭窗口')
                    }
                    windowExists = false // 标记为不存在，后续会创建新窗口

                    // 等待一小段时间确保窗口完全关闭
                    await new Promise(resolve => setTimeout(resolve, 1000))

                    console.log('✅ 已关闭现有窗口，准备创建新窗口')
                  } catch (closeError) {
                    console.error('❌ 关闭窗口也失败:', closeError)
                    windowExists = false
                  }
                }
              } else {
                console.log('🔍 窗口存在但不可用，标记为需要重建')
                windowExists = false
              }
            }
          } catch (checkError) {
            console.log('🔍 窗口检查失败，可能窗口不存在:', checkError)
            windowExists = false
          }

          // 如果窗口不存在，创建新窗口
          if (!windowExists) {
            currentUrlWindowId.value = `w${Date.now()}`
            await invoke('open_url_content_window', {
              questions: JSON.stringify(existingQuestions),
              windowId: currentUrlWindowId.value
            })

            console.log('✅ URL内容处理窗口创建成功:', {
              totalQuestions: existingQuestions.length,
              latestQuestion: questionData
            })
          }

        } catch (error) {
          console.error('❌ 处理URL内容窗口失败:', error)
        }
      }
    }
  } catch (error) {
    console.error('检查URL响应失败:', error)
  }
}

// 获取已存在的题目数据
const getExistingQuestions = () => {
  try {
    const key = currentUrlWindowId.value ? `urlContentQuestions_${currentUrlWindowId.value}` : 'urlContentQuestions'
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : []
  } catch (error) {
    console.error('获取存储的题目失败:', error)
    return []
  }
}

// 保存题目数据到本地存储
const saveQuestionsToStorage = (questions: any[]) => {
  try {
    const key = currentUrlWindowId.value ? `urlContentQuestions_${currentUrlWindowId.value}` : 'urlContentQuestions'
    localStorage.setItem(key, JSON.stringify(questions))
  } catch (error) {
    console.error('保存题目数据失败:', error)
  }
}

// ---- URL 题目视觉分析（在详情面板内执行）----

// 解析选项字符串为编号映射
const parseUrlOptions = (optionsStr: string): Map<string, string> => {
  const map = new Map<string, string>()
  if (!optionsStr?.trim()) return map
  const matches = [...optionsStr.matchAll(/(?:^|\n)\s*([A-Za-z])[\.、．]\s*([^\n]*)/g)]
  if (matches.length >= 2) {
    matches.forEach((m, i) => map.set(String(i + 1), m[2].trim()))
    return map
  }
  const lines = optionsStr.split('\n').map(l => l.trim()).filter(Boolean)
  lines.forEach((line, i) => map.set(String(i + 1), line))
  return map
}

// 从 AI 响应中解析 ANSWER: 字段并转换为原始文本
const resolveUrlAnswer = (response: string, optionMap: Map<string, string>): string => {
  const match = response.match(/ANSWER:\s*(.+)/i)
  if (!match) return ''
  const nums = match[1].trim().split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
  if (nums.length === 0) return ''
  return nums.map(n => optionMap.get(n) || n).join('###')
}

const DEFAULT_VISION_IMAGE_MIN_SIZE = 32


const applyWhiteBackgroundToDataUrl = async (dataUrl: string): Promise<string> => {
  if (!dataUrl.startsWith('data:image/')) return dataUrl

  return await new Promise((resolve) => {

    const img = new Image()
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width
        const height = img.naturalHeight || img.height
        if (!width || !height) {
          resolve(dataUrl)
          return
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }

        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

const ensureDataUrlMinimumSize = async (dataUrl: string, minimumSize = 32): Promise<string> => {
  if (!dataUrl.startsWith('data:image/')) return dataUrl

  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width
        const height = img.naturalHeight || img.height
        if (!width || !height || (width >= minimumSize && height >= minimumSize)) {
          resolve(dataUrl)
          return
        }

        const scale = Math.max(minimumSize / width, minimumSize / height, 1)
        const targetWidth = Math.max(Math.ceil(width * scale), minimumSize)
        const targetHeight = Math.max(Math.ceil(height * scale), minimumSize)

        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }

        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, targetWidth, targetHeight)
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

const extractVisionImageSizeError = (error: unknown): number | null => {
  const message = error instanceof Error ? error.message : String(error || '')
  if (!/(code"?\s*:\s*20015|height\(\d+\)\s*or\s*width\(\d+\))/i.test(message)) {
    return null
  }

  const match = message.match(/height\((\d+)\)\s*or\s*width\((\d+)\)/i)
  if (!match) return 32

  const height = Number(match[1])
  const width = Number(match[2])
  if (!Number.isFinite(height) || !Number.isFinite(width)) return 32

  return Math.max(DEFAULT_VISION_IMAGE_MIN_SIZE, Math.min(Math.max(height, width) + 16, 96))
}


const upscaleMultimodalContentImages = async (content: any[], minimumSize: number): Promise<{ content: any[], changed: boolean }> => {
  let changed = false
  const nextContent = await Promise.all(content.map(async (part) => {
    if (part?.type !== 'image_url') return part

    const originalUrl = part?.image_url?.url
    if (typeof originalUrl !== 'string' || !originalUrl.startsWith('data:image/')) return part

    const resizedUrl = await ensureDataUrlMinimumSize(originalUrl, minimumSize)
    if (resizedUrl === originalUrl) return part

    changed = true
    return {
      ...part,
      image_url: {
        ...part.image_url,
        url: resizedUrl
      }
    }
  }))

  return { content: nextContent, changed }
}

const prepareVisionRequestContent = async (content: any[], minimumSize = DEFAULT_VISION_IMAGE_MIN_SIZE): Promise<any[]> => {
  if (!Array.isArray(content) || content.length === 0) return content

  const { content: normalizedContent, changed } = await upscaleMultimodalContentImages(content, minimumSize)
  if (changed) {
    console.warn(`发送视觉请求前检测到图片尺寸不足，已自动放大到至少 ${minimumSize}px`)
  }

  return normalizedContent
}


const executeVisionModelWithAutoUpscale = async (processModel: any, input: any, config: any, abortSignal?: AbortSignal) => {


  try {
    return await processModel(input, config, abortSignal)
  } catch (error) {
    const minimumSize = extractVisionImageSizeError(error)
    const originalContent = input?.messages?.[0]?.content
    if (!minimumSize || !Array.isArray(originalContent)) {
      throw error
    }

    const { content, changed } = await upscaleMultimodalContentImages(originalContent, minimumSize)
    if (!changed) {
      throw error
    }

    console.warn(`视觉模型图片尺寸不足，已自动放大到至少 ${minimumSize}px 后重试一次`)
    return await processModel({
      ...input,
      messages: [{
        ...input.messages[0],
        content
      }]
    }, config, abortSignal)
  }
}

const buildQuestionImageMap = async (text: string): Promise<Map<string, string>> => {

  const urls = extractQuestionImageUrls(text)
  const base64Map = new Map<string, string>()


  await Promise.all(urls.map(async (url) => {
    const b64 = await fetchQuestionImageBase64(url)
    if (!b64) {
      base64Map.set(url, '')
      return
    }

    const normalizedImage = await applyWhiteBackgroundToDataUrl(b64)
    base64Map.set(url, await ensureDataUrlMinimumSize(normalizedImage, 32))
  }))


  return base64Map
}

// 将文本中所有 URL 通过后端转为 base64，返回替换后的 HTML 字符串
const buildRenderedHtml = async (title: string, options: string): Promise<string> => {
  const text = title + (options ? '\n\n选项：\n' + options : '')
  const matches = findQuestionImageMatches(text)
  const base64Map = await buildQuestionImageMap(text)

  let html = ''
  let lastIndex = 0

  for (const match of matches) {
    html += text.slice(lastIndex, match.start)
    const b64 = base64Map.get(match.normalizedUrl)
    html += b64
      ? `<img src="${b64}" style="max-width:100%;vertical-align:middle;background:#fff;display:inline-block;" />${match.trailingText}`
      : `[图片: ${match.normalizedUrl}]${match.trailingText}`
    lastIndex = match.end
  }

  html += text.slice(lastIndex)
  return html.replace(/\n/g, '<br/>')
}



// 如果请求体中的 title 含有 URL，为 log 设置 urlQuestion 展示字段（不触发分析）
const injectUrlQuestionIfNeeded = (log: RequestLog) => {
  if (log.urlQuestion) return // 已设置过，跳过
  if (!log.requestBody) return
  try {
    const rb = JSON.parse(log.requestBody)
    const title: string = rb.title || ''
    const options: string = rb.options || ''
    if (/https?:\/\//.test(title) || /https?:\/\//.test(options)) {
      log.urlQuestion = {
        title,
        options,
        imageUrl: null,
        analyzing: false,
        analysisResult: null,
        analysisError: '',
        streamingResponse: '',
        streamingReasoning: '',
        reasoningContent: '',
        renderedHtml: undefined
      }

      // 异步生成 base64 渲染 HTML
      buildRenderedHtml(title, options).then(html => {
        if (log.urlQuestion) log.urlQuestion.renderedHtml = html
      })
    }
  } catch { /* 解析失败忽略 */ }
}

// 将文本中的 URL 替换为 <img> 标签，返回 HTML 字符串（用于展示）
const renderUrlsAsHtml = (text: string): string => {
  const matches = findQuestionImageMatches(text)
  let html = ''
  let lastIndex = 0

  for (const match of matches) {
    html += text.slice(lastIndex, match.start)
    html += `<img src="${match.normalizedUrl}" style="max-width:100%;vertical-align:middle;" />${match.trailingText}`
    lastIndex = match.end
  }

  return html + text.slice(lastIndex)
}



// 将文本按 URL 拆分为多模态内容数组，并先在本地拉取图片转成 base64
const buildMultimodalContent = async (text: string): Promise<any[]> => {
  const matches = findQuestionImageMatches(text)
  const base64Map = await buildQuestionImageMap(text)
  const failedUrls: string[] = []
  const parts: any[] = []
  let lastIndex = 0

  for (const match of matches) {
    const before = text.slice(lastIndex, match.start)
    if (before) parts.push({ type: 'text', text: before })

    const imageBase64 = base64Map.get(match.normalizedUrl)
    if (imageBase64) {
      parts.push({ type: 'image_url', image_url: { url: imageBase64, detail: 'high' } })
    } else {
      failedUrls.push(match.normalizedUrl)
    }

    if (match.trailingText) parts.push({ type: 'text', text: match.trailingText })
    lastIndex = match.end
  }

  const tail = text.slice(lastIndex)
  if (tail) parts.push({ type: 'text', text: tail })

  if (failedUrls.length > 0) {
    throw new Error(`以下图片本地下载失败，无法转为 base64：${failedUrls.join('，')}`)
  }

  return parts
}


// 对指定 requestId 的 URL 题目执行视觉分析
const analyzeUrlQuestion = async (requestId: string) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log?.urlQuestion) return
  // 防止重复分析
  if (log.urlQuestion.analyzing || log.urlQuestion.analysisResult || activeUrlAnalysisRequestIds.has(requestId)) return
  if (isRequestCancelled(requestId)) return

  const visionModel = globalSelectedVisionModel.value
  if (!visionModel) {
    const errorMessage = '请先在模型选择中配置视觉模型'
    log.urlQuestion.analysisError = errorMessage
    log.urlQuestion.analyzing = false
    log.urlQuestion.streamingResponse = ''
    log.urlQuestion.streamingReasoning = ''
    log.urlQuestion.reasoningContent = ''
    log.modelResponse = `错误: ${errorMessage}`
    log.isModelCalling = false
    await sendModelResponseToBackend(requestId, `错误: ${errorMessage}`, false)
    return
  }


  activeUrlAnalysisRequestIds.add(requestId)
  const abortController = new AbortController()
  registerAbortController(requestId, abortController)
  log.urlQuestion.analyzing = true
  log.urlQuestion.analysisResult = null
  log.urlQuestion.analysisError = ''
  log.urlQuestion.streamingResponse = ''
  log.urlQuestion.streamingReasoning = ''
  log.urlQuestion.reasoningContent = ''


  try {
    const platform = platforms.value.find(p => p.models.some(m => m.id === visionModel.id))
    if (!platform) throw new Error('找不到视觉模型对应的平台')

    const { title, options } = log.urlQuestion
    const optionMap = parseUrlOptions(options)
    const hasOptions = optionMap.size > 0

    // 构建选项文本
    let optionsText = ''
    if (hasOptions) {
      optionsText = '\n\n选项：\n' + Array.from(optionMap.entries()).map(([k, v]) => `${k}. ${v}`).join('\n')
    }

    const instruction = `\n\n请仔细分析上述题目，给出详细的解题过程和答案。\n\n在回答末尾，严格按照以下格式单独一行给出答案：\nANSWER: <答案>\n\n其中规则：\n${hasOptions
      ? `- 单选题：写正确选项的编号，如 ANSWER: 2\n- 多选题：多个编号用空格分隔，如 ANSWER: 1 3\n- 判断题：写 正确 或 错误`
      : `- 填空/解答题：写完整答案内容，如 ANSWER: 42`}`

    // 将 title + options + instruction 拼成完整文本，按 URL 拆分为交错多模态内容
    // 图片会先在本地拉取并转为 base64，再发送给视觉模型
    const fullText = title + optionsText + instruction
    const multimodalContent = await buildMultimodalContent(fullText)
    const preparedMultimodalContent = await prepareVisionRequestContent(multimodalContent)

    const analysisInput = {
      messages: [{ role: 'user', content: preparedMultimodalContent }],

      model: visionModel.id,
      stream: true
    }
    const config = { apiKey: platform.apiKey, baseUrl: platform.baseUrl, model: visionModel.id, ...visionModel }

    const tauriHttp = await import('@tauri-apps/plugin-http')
    const tauriFetch: typeof fetch = ((input: RequestInfo | URL, init: RequestInit = {}) =>
      tauriHttp.fetch(input as any, {
        ...init,
        credentials: init.credentials ?? 'include',
        signal: init.signal ?? abortController.signal
      } as any)) as typeof fetch

    if (!visionModel.jsCode) throw new Error('视觉模型未配置 JavaScript 代码')

    const executableCode = visionModel.jsCode.trim()
    let processModel: any
    if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
      processModel = new Function('input', 'config', 'fetch', 'abortSignal', `${executableCode}\nreturn processModel;`)(analysisInput, config, tauriFetch, abortController.signal)
    } else {
      processModel = new Function('input', 'config', 'fetch', 'abortSignal', `return (async function processModel(input, config) { ${executableCode} });`)(analysisInput, config, tauriFetch, abortController.signal)
    }

    const result = await executeVisionModelWithAutoUpscale(processModel, analysisInput, config, abortController.signal)

    if (!result) throw new Error('模型未返回有效结果')

    // 启动心跳，防止后端 inactivity 超时
    if (!heartbeatIntervals.has(requestId)) {
      const timerId = window.setInterval(() => {
        const l = requestLogs.value.find(x => x.id === requestId)
        const currentContent = l?.urlQuestion?.streamingResponse || ''
        sendModelProgressToBackend(requestId, currentContent)
      }, 1000)
      heartbeatIntervals.set(requestId, timerId)
    }

    let fullResponse = ''
    let fullReasoning = ''
    if (result[Symbol.asyncIterator]) {
      for await (const chunk of result) {
        if (chunk.content) {
          fullResponse += chunk.content
          const l = requestLogs.value.find(x => x.id === requestId)
          if (l?.urlQuestion) l.urlQuestion.streamingResponse = fullResponse
        }
        const reasoning = getReasoningContentValue(chunk)
        if (reasoning) {
          fullReasoning += reasoning
          const l = requestLogs.value.find(x => x.id === requestId)
          if (l?.urlQuestion) l.urlQuestion.streamingReasoning = fullReasoning
        }
      }
    } else {
      fullResponse = typeof result === 'string'
        ? result
        : typeof result?.content === 'string'
          ? result.content
          : JSON.stringify(result)
      fullReasoning = typeof result === 'string' ? '' : getReasoningContentValue(result)
    }


    // 停止心跳
    const timerId = heartbeatIntervals.get(requestId)
    if (typeof timerId === 'number') { window.clearInterval(timerId); heartbeatIntervals.delete(requestId) }

    const answer = resolveUrlAnswer(fullResponse, optionMap)
    const l = requestLogs.value.find(x => x.id === requestId)
    if (l?.urlQuestion) {
      l.urlQuestion.analysisResult = fullResponse
      l.urlQuestion.reasoningContent = fullReasoning
      l.urlQuestion.streamingReasoning = ''
      l.urlQuestion.analyzing = false
    }
    if (l) l.isModelCalling = false

    if (isRequestCancelled(requestId)) return

    if (answer) {
      await sendModelResponseToBackend(requestId, JSON.stringify({ answer }), true, fullReasoning)
    } else {
      await sendModelResponseToBackend(requestId, fullResponse, true, fullReasoning)
    }

  } catch (err: any) {
    if (isAbortLikeError(err) || isRequestCancelled(requestId)) {
      return
    }
    // 停止心跳
    clearRequestHeartbeat(requestId)
    const l = requestLogs.value.find(x => x.id === requestId)
    if (l?.urlQuestion) {
      l.urlQuestion.analysisError = err.message || '分析失败'
      l.urlQuestion.streamingReasoning = ''
      l.urlQuestion.analyzing = false
    }

    if (l) l.isModelCalling = false
    // 通知后端分析失败，让 wait_for_model_response 尽快返回错误
    await sendModelResponseToBackend(requestId, `错误: ${err.message || '分析失败'}`, false)
  } finally {
    clearRequestHeartbeat(requestId)
    unregisterAbortController(requestId, abortController)
    cancelledRequestIds.delete(requestId)
    activeUrlAnalysisRequestIds.delete(requestId)
  }
}



onUnmounted(() => {
  // 清理SSE连接和轮询定时器
  stopSSEConnection()
  stopLogPolling()
  detailContentObserver?.disconnect()
  if (scrollHideTimer) clearTimeout(scrollHideTimer)
})

</script>

<style scoped>
.home-page {
  background-color: var(--bg-secondary);
  border-radius: 4px;
  height: calc(100% - 5px);
  width: calc(100% - 5px);
  margin: 0 2px 2px 0;
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  overflow: hidden;
  padding-bottom: 0px;
}

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

@media (max-width: 768px) {
  .home-page {
    padding: 16px;
    gap: 16px;
  }
}

/* 请求记录布局样式 */
.request-logs-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 4px;
  overflow: hidden;
}

.request-logs-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  transition: width 0.3s ease;
}

.request-logs {
  margin-top: 40px;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.logs-title {
  font-size: 20px;
  font-weight: 600;
  color: #2d3748;
  margin: 0;
}

.request-logs-card {
  background: var(--bg-secondary);
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.request-logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
}

.request-logs-info {
  display: flex;
  align-items: center;
  gap: 20px;
}

.request-logs-details {
  flex: 1;
}

.request-logs-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.request-logs-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 20px;
  padding: 0 8px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  border-radius: 10px;
}

.request-logs-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.request-table-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.request-table-scroll-wrap {
  position: relative;
  flex: 1;
  display: flex;
  overflow: hidden;
}

.request-table-scroll-wrap.is-dragging .request-table {
  pointer-events: none; /* 拖拽时禁用表格事件，防止和hover冲突 */
}

.request-table-content {
  overflow-y: auto;
  flex: 1;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding-right: 10px; /* 给右侧滚动条留出空间，防止和表格横线内容重叠 */
}

.request-table-content::-webkit-scrollbar { display: none; }
.request-table-content::-webkit-scrollbar-button { display: none; }

.custom-scrollbar {
  position: absolute;
  right: 3px;
  top: 4px;
  bottom: 4px;
  width: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  pointer-events: none;
}

.custom-scrollbar.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.custom-scrollbar-thumb {
  width: 4px;
  border-radius: 4px;
  background: var(--custom-scrollbar-thumb);
  transition: background 0.15s;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}

.custom-scrollbar-thumb:hover {
  background: var(--custom-scrollbar-thumb-hover);
}

.custom-scrollbar:hover .custom-scrollbar-thumb {
  background: var(--text-tertiary);
}

.request-table {
  width: 100%;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  table-layout: fixed;
  color: var(--text-primary);
}

.request-table thead {
  border-bottom: 2px solid var(--border-primary);
}

.request-table th {
  padding: 12px 8px;
  text-align: left;
  font-weight: 500;
  color: var(--ql-th-text);
  border-bottom: 1px solid var(--border-primary);
  white-space: nowrap;
  position: relative;
}

.request-table th:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 20%;
  bottom: 20%;
  width: 1px;
  background: var(--ql-divider);
}

.request-table th:nth-child(1) {
  width: 120px;
}

/* 时间 */
.request-table th:nth-child(2) {
  width: 80px;
}

/* 状态 */
.request-table th:nth-child(3) {
  width: 120px;
}

/* IP地址 */
.request-table th:nth-child(4) {
  width: auto;
}

/* 问题 */
.request-table th:nth-child(5) {
  width: 100px;
}

/* 响应时间 */

.request-table tbody tr {
  cursor: pointer;
  transition: background-color 0.2s ease;
  position: relative;
}

.request-table tbody tr:hover {
  background-color: var(--ql-row-hover-bg);
}

.request-table td {
  padding: 12px 8px;
  border-bottom: 1px solid var(--border-primary);
  vertical-align: middle;
  word-wrap: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  position: relative;
}

.request-table tbody tr td:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 20%;
  bottom: 20%;
  width: 1px;
  background: var(--ql-table-divider);
  opacity: 0.6;
}

.request-table tbody tr:hover td:not(:last-child)::after {
  background: var(--ql-table-divider-hover);
  opacity: 0.8;
}

.request-table tbody tr:last-child td {
  border-bottom: none;
}

.no-requests {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #a0aec0;
  padding: 40px 20px;
}

.clear-logs-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #718096;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-logs-btn:hover {
  background: #fed7d7;
  border-color: #fc8181;
  color: #e53e3e;
}

.logs-container.request-logs-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.time {
  color: #718096;
  font-family: 'Courier New', monospace;
  font-size: 13px;
}

.method {
  font-weight: 600;
  font-family: 'Courier New', monospace;
}

.method-get {
  color: #38a169;
}

.method-post {
  color: #3182ce;
}

.method-put {
  color: #d69e2e;
}

.method-delete {
  color: #e53e3e;
}

.method-patch {
  color: #805ad5;
}

.path {
  font-family: 'Courier New', monospace;
  color: #4a5568;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-text {
  font-size: 14px;
  font-weight: 600;
  font-family: 'Courier New', monospace;
}

.status-text.success {
  color: #38a169;
}

.status-text.redirect {
  color: #d69e2e;
}

.status-text.client-error {
  color: #e53e3e;
}

.status-text.server-error {
  color: #e53e3e;
}

.status-text.unknown {
  color: #718096;
}

.status-text.pending {
  color: #3182ce;
  animation: pulse 2s infinite;
}

@keyframes pulse {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.6;
  }
}

.pending {
  color: #718096;
  font-style: italic;
}

.ip {
  font-family: 'Courier New', monospace;
  font-size: 13px;
}





/* 右侧弹出请求详情面板样式 */
.request-details-overlay {
  position: fixed;
  top: 0;
  right: 0;
  width: 50%;
  height: 100vh;
  background-color: var(--bg-secondary);
  border-left: 1px solid var(--bg-primary);
  box-shadow: -2px 0 8px var(--request-details-shadow);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 初始状态：完全隐藏在右侧 */
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 显示状态：滑入到正常位置 */
.request-details-overlay.show {
  transform: translateX(0);
}

/* 拖拽条样式 */
.resizer {
  position: absolute;
  left: 0;
  top: 0;
  width: 4px;
  height: 100%;
  background-color: transparent;
  cursor: ew-resize;
  z-index: 1001;
  transition: background-color 0.2s ease;
}

.resizer:hover {
  background-color: var(--request-details-resizer-hover);
}

.resizer.active {
  background-color: var(--request-details-resizer-active);
}

/* 拖拽时的全局样式 */
body.resizing {
  cursor: ew-resize !important;
  user-select: none;
}

.request-details-header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  gap: 12px;
  flex-shrink: 0;
}

.request-details-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--request-details-header-text);
  flex: 1;
}

.back-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--request-details-back-btn-text);
}

.back-btn:hover {
  background-color: var(--request-details-back-btn-hover);
}

.request-details-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: hidden;
  /* 仅让下方内容区滚动，标签固定 */
  padding: 0;
  /* 将内边距下移到 tab-content，避免滚动裁剪 */
}

/* 标签页导航样式 */
.detail-tabs {
  display: flex;
  border-bottom: 1px solid var(--bg-primary);
  margin-bottom: 0;
  /* 下方内容区自身有内边距 */
  gap: 4px;
  padding: 0 24px;
  /* 与内容区内边距对齐 */
}

.tab-button {
  padding: 12px 20px;
  border: none;
  background: transparent;
  color: var(--request-details-tab-text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.tab-button::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 0;
  height: 3px;
  background: var(--request-details-tab-active);
  transition: all 0.2s ease;
  transform: translateX(-50%);
}



.tab-button:hover::after {
  width: 20%;
}

.tab-button.active::after {
  width: 40%;
}


/* 标签页内容样式 */
.detail-scroll-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tab-content {
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 24px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.tab-content::-webkit-scrollbar,
.tab-content::-webkit-scrollbar-button {
  display: none;
}

.custom-scrollbar {
  position: absolute;
  top: 8px;
  right: 6px;
  bottom: 8px;
  width: 6px;
  border-radius: 999px;
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
  z-index: 2;
}

.custom-scrollbar.has-overflow {
  pointer-events: auto;
}

.custom-scrollbar.is-visible.has-overflow {
  opacity: 1;
}

.custom-scrollbar-thumb {
  position: absolute;
  top: 0;
  right: 1px;
  width: 4px;
  border-radius: 4px;
  background: var(--custom-scrollbar-thumb);
  transition: background 0.15s ease;
}

.custom-scrollbar-thumb:hover {
  background: var(--custom-scrollbar-thumb-hover);
}

.custom-scrollbar:hover .custom-scrollbar-thumb {
  background: var(--text-tertiary);
}


/* 选中行样式 */
.request-row.selected {
  background: var(--ql-row-active-bg) !important;
}

.request-row.selected td:not(:last-child)::after {
  background: var(--ql-table-divider-active);
  opacity: 1;
}

.request-row.selected:hover {
  background: var(--ql-row-active-bg) !important;
}

.detail-section {
  margin-bottom: 24px;
}

.detail-section:last-child {
  margin-bottom: 0;
}

.detail-section h4 {
  font-size: 16px;
  font-weight: 600;
  color: var(--request-details-section-title);
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--request-details-section-border);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-item label {
  font-weight: 500;
  color: var(--request-details-label-text);
  min-width: 80px;
}

.detail-item span {
  color: var(--request-details-value-text);
}

.headers-content {
  background: var(--request-details-headers-bg);
  border-radius: 8px;
  padding: 16px;
  border: 1px solid var(--request-details-headers-border);
}

.header-item {
  margin-bottom: 8px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  color: var(--request-details-headers-text);
}

.header-item:last-child {
  margin-bottom: 0;
}

.header-item strong {
  color: var(--request-details-headers-strong);
}

.code-content {
  background: var(--request-details-code-bg);
  color: var(--request-details-code-text);
  border-radius: 8px;
  padding: 16px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  border: 1px solid var(--request-details-code-border);
  overflow-y: auto;
}

.no-logs {
  text-align: center;
  padding: 60px 20px;
  color: var(--request-details-label-text);
}

.no-logs-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  opacity: 0.5;
}

.no-logs p {
  margin: 0;
  font-size: 16px;
}

/* 模型响应相关样式 */
/* 模型信息样式 */
.model-info {
  margin-bottom: 16px;
  padding: 16px;
  background: var(--request-details-basic-bg);
  border-radius: 8px;
  border: 1px solid var(--request-details-basic-border);
}

.model-info-header {
  margin-bottom: 12px;
}

.model-info-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--request-details-label-text);
}

.model-info-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-info-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-info-item label {
  font-weight: 500;
  color: var(--request-details-label-text);
  min-width: 60px;
  font-size: 13px;
}

.model-info-item span {
  color: var(--request-details-value-text);
  font-size: 13px;
  font-family: 'Courier New', monospace;
}

.model-calling {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--request-details-model-calling-bg);
  border-radius: 8px;
  color: var(--request-details-model-calling-text);
}

.loading-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.streaming-response {
  position: relative;
  margin-top: 12px;
}

.streaming-response .code-content.streaming {
  background: var(--request-details-streaming-bg);
  border-color: var(--request-details-streaming-border);
  color: var(--request-details-streaming-text);
  padding-right: 20px;
}





/* 无数据提示样式 */
.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  background: var(--request-details-headers-bg);
  border-radius: 8px;
  border: 1px solid var(--request-details-headers-border);
}

.no-data-text {
  color: var(--request-details-label-text);
  font-size: 14px;
  opacity: 0.7;
  font-style: italic;
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

/* 响应式设计 */
@media (max-width: 1024px) {
  .logs-table {
    font-size: 13px;
  }

  .logs-table th,
  .logs-table td {
    padding: 10px 8px;
  }

  .title {
    max-width: 150px;
  }

  .path {
    max-width: 120px;
  }
}

@media (max-width: 768px) {
  .logs-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .logs-table {
    font-size: 12px;
  }

  .logs-table th,
  .logs-table td {
    padding: 8px 6px;
  }

  .title,
  .path {
    max-width: 100px;
  }

  .time {
    font-size: 11px;
  }
}

/* 多模型对比视图 */
.multi-model-header {
  margin-bottom: 16px;
}

.multi-model-comparison {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 横向模型切换 tab */
.multi-model-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.multi-model-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 20px;
  background: var(--multi-model-tab-bg);
  color: var(--multi-model-tab-text);
  box-shadow: var(--multi-model-tab-shadow);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
  white-space: nowrap;
}

.multi-model-tab:hover {
  background: var(--multi-model-tab-hover-bg);
  border-color: var(--multi-model-tab-hover-border);
  color: var(--multi-model-tab-hover-text);
  box-shadow: var(--multi-model-tab-hover-shadow);
  transform: translateY(-1px);
}

.multi-model-tab.active {
  background: var(--multi-model-tab-active-bg);
  border-color: var(--multi-model-tab-active-border);
  color: var(--multi-model-tab-active-text);
  box-shadow: var(--multi-model-tab-active-shadow);
}

.multi-model-tab.summary {
  background: var(--multi-model-tab-summary-bg);
  color: var(--multi-model-tab-summary-text);
  box-shadow: none;
}

.multi-model-tab.summary:hover {
  background: var(--multi-model-tab-summary-hover-bg);
  border-color: var(--multi-model-tab-summary-hover-border);
  color: var(--multi-model-tab-summary-hover-text);
  box-shadow: none;
}

.multi-model-tab.summary.active {
  background: var(--multi-model-tab-summary-active-bg);
  border-color: var(--multi-model-tab-summary-active-border);
  color: var(--multi-model-tab-summary-active-text);
  box-shadow: var(--multi-model-tab-active-shadow), var(--multi-model-tab-summary-active-glow);
}


.multi-model-tab.loading {
  opacity: 0.75;
}

.multi-model-tab.failed {
  background: var(--multi-model-tab-failed-bg);
  color: var(--multi-model-tab-failed-text);
  box-shadow: none;
}



.multi-model-tab.failed:hover {
  background: var(--multi-model-tab-failed-hover-bg);
  color: var(--multi-model-tab-failed-hover-text);
  box-shadow: inset 0 0 0 1px var(--multi-model-tab-failed-hover-border), var(--multi-model-tab-failed-shadow);
}

.multi-model-tab.failed.active {
  background: var(--multi-model-tab-failed-active-bg);
  color: var(--multi-model-tab-failed-active-text);
  box-shadow: inset 0 0 0 1px var(--multi-model-tab-failed-active-border), var(--multi-model-tab-failed-active-shadow);
}

.model-response-card {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid transparent;
  background: var(--model-response-card-bg);
  transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
}

.model-response-card.is-loading {
  border-color: transparent;
  box-shadow: none;
}

.model-response-card.is-summary {
  background: var(--model-response-card-summary-bg);
}

.model-response-card.is-summary .model-response-card-header {
  background: var(--model-response-card-summary-header-bg);
}

.model-response-card.is-summary .model-response-card-header::after {
  background: var(--model-response-card-summary-divider);
}

.summary-result-icon {
  color: var(--model-response-card-summary-accent);
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.summary-tag {
  background: var(--model-response-card-summary-tag-bg);
  color: var(--model-response-card-summary-tag-text);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 700;
  white-space: nowrap;
}

.model-response-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  gap: 12px;
  position: relative;
}

.model-response-card-header::after {
  content: '';
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 0;
  height: 1px;
  background: var(--model-response-card-divider);
}

.model-response-card-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.card-model-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--model-response-card-title);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-platform-name {
  font-size: 11px;
  color: var(--model-response-card-muted-text);
  opacity: 0.7;
  white-space: nowrap;
}

.card-loading-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--model-response-card-muted-text);
  flex-shrink: 0;
}

.card-done-badge {
  font-size: 12px;
  color: var(--model-response-card-success-text);
  font-weight: 500;
  flex-shrink: 0;
}

.model-response-card-body {
  padding: 14px 16px;
}



/* Small spinner for card header */
.loading-spinner-sm {
  width: 12px;
  height: 12px;
  border: 2px solid var(--model-response-card-spinner-track);
  border-top-color: var(--model-response-card-spinner-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

/* Loading dots for card waiting state */
.card-waiting {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60px;
}

.loading-dots {
  display: flex;
  gap: 6px;
  align-items: center;
}

.loading-dots span {
  width: 7px;
  height: 7px;
  background: var(--model-response-card-muted-text);
  border-radius: 50%;
  opacity: 0.4;
  animation: dot-pulse 1.2s ease-in-out infinite;
}

.loading-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.loading-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dot-pulse {

  0%,
  80%,
  100% {
    opacity: 0.4;
    transform: scale(0.8);
  }

  40% {
    opacity: 1;
    transform: scale(1.1);
  }
}

/* 思考过程展示参考 ModelTestDialog */
.content-stack {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.response-section,
.reasoning-section {
  width: 100%;
  margin-top: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  overflow: visible;
  background: transparent;
  box-shadow: none;
}

.response-section {
  padding-top: 2px;
}

.response-content,
.reasoning-content {
  margin-top: 0;
  line-height: 1.85;
}

.response-content {
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 500;
}

.response-content.streaming {
  animation: none;
}

.reasoning-section {
  padding: 8px 0 8px 16px;
  border-left: 1px solid var(--model-response-card-divider);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--model-response-card-muted-text);
}

.reasoning-title {
  color: var(--text-secondary);
}

.reasoning-content {
  color: var(--text-secondary);
  font-size: 15px;
}

.reasoning-content.streaming {
  min-height: 40px;
}


/* URL 题目视觉分析面板 */
.url-analysis-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.url-image-box {
  background: var(--bg-tertiary, #f8f9fa);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.url-rendered-image {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

.url-analysis-result {
  min-height: 40px;
}

.url-analysis-error {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #e74c3c;
  font-size: 13px;
}

.retry-btn-sm {
  padding: 3px 10px;
  border: 1px solid var(--color-primary, #007acc);
  background: transparent;
  color: var(--color-primary, #007acc);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  transition: all 0.15s;
}

.retry-btn-sm:hover {
  background: var(--color-primary, #007acc);
  color: white;
}
</style>
