using System;
using System.Configuration;

namespace DeepSeekProxy.Properties
{
    public class Settings : ApplicationSettingsBase
    {
        private static Settings defaultInstance = ((Settings)(ApplicationSettingsBase.Synchronized(new Settings())));
        
        public static Settings Default
        {
            get
            {
                return defaultInstance;
            }
        }
        
        [UserScopedSetting()]
        [DefaultSettingValue("")]
        public string DeepseekApiKey
        {
            get
            {
                return ((string)(this["DeepseekApiKey"]));
            }
            set
            {
                this["DeepseekApiKey"] = value;
            }
        }
        
        [UserScopedSetting()]
        [DefaultSettingValue("")]
        public string AliyunApiKey
        {
            get
            {
                return ((string)(this["AliyunApiKey"]));
            }
            set
            {
                this["AliyunApiKey"] = value;
            }
        }
        
        [UserScopedSetting()]
        [DefaultSettingValue("")]
        public string SiliconFlowApiKey
        {
            get
            {
                return ((string)(this["SiliconFlowApiKey"]));
            }
            set
            {
                this["SiliconFlowApiKey"] = value;
            }
        }
        
        [UserScopedSetting()]
        [DefaultSettingValue("deepseek")]
        public string LastApiType
        {
            get
            {
                return ((string)(this["LastApiType"]));
            }
            set
            {
                this["LastApiType"] = value;
            }
        }
    }
}