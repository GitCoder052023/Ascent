Pod::Spec.new do |s|
  s.name           = 'RecordingKeepalive'
  s.version        = '1.0.0'
  s.summary        = 'Android CPU wake lock and battery exemption helpers'
  s.description    = 'Android CPU wake lock and battery exemption helpers'
  s.author         = 'Ascent'
  s.homepage       = 'https://github.com/expo/expo'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
