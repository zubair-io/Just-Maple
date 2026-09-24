import Foundation

/// Text extraction only: no WebView, remote images, stylesheet loads, or executable HTML.
public enum MailText {
    public static func visible(_ input:String)->String {
        var text=input
        if text.range(of:"(?i)<(?:html|body|div|p|table|br|span)(?:\\s|>)",options:.regularExpression) != nil {
            text=text.replacingOccurrences(of:"(?is)<(head|style|script)[^>]*>.*?</\\1\\s*>",with:"",options:.regularExpression)
            text=text.replacingOccurrences(of:"(?i)</(?:p|div|tr|li|h[1-6])\\s*>|<br\\s*/?>",with:"\n",options:.regularExpression)
            text=text.replacingOccurrences(of:"<[^>]+>",with:"",options:.regularExpression)
        }
        for (entity,value) in [("&nbsp;"," "),("&rsquo;","’"),("&lsquo;","‘"),("&rdquo;","”"),("&ldquo;","“"),("&quot;","\""),("&#39;","'"),("&lt;","<"),("&gt;",">"),("&amp;","&")] {text=text.replacingOccurrences(of:entity,with:value)}
        text=text.components(separatedBy:.newlines).map{$0.trimmingCharacters(in:.whitespaces)}.filter{!$0.isEmpty}.joined(separator:"\n")
        // Login credentials are not useful evidence for a personal-state/task classifier.
        text=text.replacingOccurrences(of:"(?im)((?:temporary |login |one.time |reset )?(?:password|passcode|verification code)\\s*:\\s*)\\S+",with:"$1[redacted]",options:.regularExpression)
        text=text.replacingOccurrences(of:"(?i)([?&](?:token|code|password|key)=)[^\\s&]+",with:"$1[redacted]",options:.regularExpression)
        return text
    }
}
